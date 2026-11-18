/*
 * Escenario: ciclo de vida de una petición HTTP en Laravel 11/12.
 * Ejemplo: GET /multas/123 en una app con sesión en Redis y MySQL.
 */
window.SCENARIOS = window.SCENARIOS || [];
window.SCENARIOS.push({
  id: 'http',
  name: 'Petición HTTP',
  category: 'Ciclo de vida',
  icon: { kind: 'server', glyph: 'globe', group: 'laravel' },
  tagline: 'Qué pasa desde que el navegador pide /multas/123 hasta que recibe el HTML',
  nodes: [
    { id: 'browser',    label: 'Navegador',        sub: '192.168.1.10',          x: 80,  y: 300, group: 'client' },
    { id: 'nginx',      label: 'Nginx',            sub: ':443 · TLS',            x: 220, y: 300, group: 'server' },
    { id: 'fpm',        label: 'PHP-FPM',          sub: 'pool www · :9000',      x: 360, y: 300, group: 'server' },
    { id: 'index',      label: 'public/index.php', sub: 'punto de entrada',      x: 360, y: 110, group: 'laravel' },
    { id: 'app',        label: 'Application',      sub: 'bootstrap/app.php',     x: 500, y: 110, group: 'laravel' },
    { id: 'providers',  label: 'Service Providers',sub: 'register → boot',       x: 640, y: 110, group: 'laravel' },
    { id: 'redis',      label: 'Redis',            sub: 'sesión · caché',        x: 780, y: 110, group: 'data' },
    { id: 'kernel',     label: 'HTTP Kernel',      sub: 'middleware global',     x: 500, y: 300, group: 'laravel' },
    { id: 'router',     label: 'Router',           sub: 'routes/web.php',        x: 640, y: 300, group: 'laravel' },
    { id: 'middleware', label: 'Middleware ruta',  sub: 'grupo web + auth',      x: 780, y: 300, group: 'laravel' },
    { id: 'controller', label: 'MultaController',  sub: '@show',                 x: 920, y: 300, group: 'laravel' },
    { id: 'terminate',  label: 'Terminate',        sub: 'logs · afterResponse',  x: 500, y: 490, group: 'laravel' },
    { id: 'view',       label: 'Blade',            sub: 'multas/show.blade.php', x: 640, y: 490, group: 'laravel' },
    { id: 'db',         label: 'MySQL',            sub: 'transito · :3306',      x: 780, y: 490, group: 'data' },
    { id: 'model',      label: 'Eloquent',         sub: 'App\\Models\\Multa',    x: 920, y: 490, group: 'laravel' }
  ],
  steps: [
    {
      title: 'Llega la petición',
      subtitle: 'Nginx la recibe y se la pasa a PHP',
      description:
        'El navegador envía GET /multas/123 junto con la cookie de sesión. Nginx termina el TLS, ve que la ruta no es un archivo estático y, gracias a try_files, se la pasa a PHP-FPM por FastCGI. Un worker libre del pool ejecuta public/index.php. Laravel todavía no existe en memoria: cada petición arranca de cero (salvo que uses Octane).',
      code:
`# /etc/nginx/sites-available/app.conf
location / {
    try_files $uri $uri/ /index.php?$query_string;
}

location ~ \\.php$ {
    fastcgi_pass unix:/run/php/php8.3-fpm.sock;
    fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
    include fastcgi_params;
}`,
      facts: [['Protocolo', 'HTTP/2 sobre TLS 1.3'], ['Nginx → PHP', 'FastCGI (socket Unix)'], ['Archivo ejecutado', 'public/index.php']],
      events: [
        { t: 0.000, from: 'browser', to: 'nginx', type: 'request',  label: 'GET /multas/123', info: 'GET /multas/123 HTTP/2 · Cookie: laravel_session=eyJp…', size: '612 B' },
        { t: 0.001, from: 'nginx',   to: 'fpm',   type: 'request',  label: 'FastCGI',         info: 'FastCGI BEGIN_REQUEST · SCRIPT_FILENAME=/var/www/app/public/index.php', size: '1.1 KB' },
        { t: 0.002, from: 'fpm',     to: 'index', type: 'internal', label: 'index.php',       info: 'Worker PHP-FPM ejecuta public/index.php' }
      ]
    },
    {
      title: 'Arranque de la aplicación',
      subtitle: 'Autoload, contenedor y Service Providers',
      description:
        'index.php carga el autoloader de Composer y crea la Application desde bootstrap/app.php. La Application es el contenedor de inyección de dependencias. Luego cada Service Provider pasa por dos fases: register() (solo registra bindings en el contenedor) y boot() (usa lo ya registrado: carga rutas, eventos, gates, macros). Con config:cache y route:cache esta fase es mucho más rápida.',
      code:
`// public/index.php
require __DIR__.'/../vendor/autoload.php';

/** @var Application $app */
$app = require_once __DIR__.'/../bootstrap/app.php';

$app->handleRequest(Request::capture());

// bootstrap/app.php (Laravel 11+)
return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(web: __DIR__.'/../routes/web.php')
    ->withMiddleware(function (Middleware $middleware) { /* … */ })
    ->withExceptions(function (Exceptions $exceptions) { /* … */ })
    ->create();`,
      facts: [['Contenedor', 'Illuminate\\Foundation\\Application'], ['Fase 1', 'register(): bindings'], ['Fase 2', 'boot(): rutas, eventos, gates'], ['Optimización', 'php artisan optimize']],
      events: [
        { t: 0.003, from: 'index',     to: 'app',       type: 'internal', label: 'autoload + app', info: 'require vendor/autoload.php · require bootstrap/app.php' },
        { t: 0.006, from: 'app',       to: 'providers', type: 'internal', label: 'register()',     info: 'Registra bindings: db, cache, session, auth, router…' },
        { t: 0.014, from: 'providers', to: 'app',       type: 'internal', label: 'boot()',         info: 'boot(): carga rutas, listeners, gates y policies' }
      ]
    },
    {
      title: 'HTTP Kernel',
      subtitle: 'La Request cruza el middleware global',
      description:
        'La Application crea el objeto Request a partir de las variables globales de PHP y se lo entrega al HTTP Kernel. El Kernel lo pasa por el middleware global, que se aplica a todas las peticiones: confiar en proxies, CORS, modo mantenimiento, tamaño máximo de POST, limpiar espacios y convertir cadenas vacías en null.',
      code:
`// Middleware global por defecto (Laravel 11+)
TrustProxies::class,
HandleCors::class,
PreventRequestsDuringMaintenance::class,
ValidatePostSize::class,
TrimStrings::class,
ConvertEmptyStringsToNull::class,

// Agregar uno propio en bootstrap/app.php
->withMiddleware(function (Middleware $middleware) {
    $middleware->append(RegistrarAuditoria::class);
})`,
      facts: [['Objeto', 'Illuminate\\Http\\Request'], ['Patrón', 'Pipeline (cebolla)'], ['Si el sitio está en mantenimiento', 'responde 503 aquí mismo']],
      events: [
        { t: 0.015, from: 'app',    to: 'kernel', type: 'request', label: 'Request',      info: 'handleRequest(Request::capture()) → HTTP Kernel' },
        { t: 0.017, from: 'kernel', to: 'router', type: 'request', label: 'mw global ✓',  info: 'TrustProxies → HandleCors → TrimStrings → ConvertEmptyStringsToNull → Router' }
      ]
    },
    {
      title: 'Enrutamiento',
      subtitle: 'El Router busca qué ruta coincide',
      description:
        'El Router compara el método y la URI con las rutas registradas. GET /multas/{multa} coincide, así que ya sabe qué controlador ejecutar y qué middleware de ruta aplicar (el grupo web y auth). Si ninguna ruta coincidiera, aquí se lanzaría un 404.',
      code:
`// routes/web.php
Route::middleware('auth')->group(function () {
    Route::get('/multas/{multa}', [MultaController::class, 'show'])
        ->name('multas.show');
});

// Ver todas las rutas registradas
php artisan route:list --path=multas`,
      facts: [['Ruta', 'GET /multas/{multa}'], ['Nombre', 'multas.show'], ['Middleware', 'web, auth'], ['Sin coincidencia', '404 NotFoundHttpException']],
      events: [
        { t: 0.018, from: 'router', to: 'middleware', type: 'request', label: 'multas.show', info: 'Coincide GET /multas/{multa} → middleware: web, auth' }
      ]
    },
    {
      title: 'Middleware de ruta',
      subtitle: 'Sesión, autenticación y route model binding',
      description:
        'Ahora corren los middleware propios de la ruta. StartSession lee la sesión desde Redis. Authenticate busca al usuario de esa sesión en la tabla users; si no hay usuario, redirige a /login. Por último, SubstituteBindings convierte el {multa} de la URL en un modelo Multa consultando MySQL (si no existe, 404).',
      code:
`// Grupo "web" (resumen)
EncryptCookies::class,
StartSession::class,
ShareErrorsFromSession::class,
ValidateCsrfToken::class,     // solo POST/PUT/PATCH/DELETE
SubstituteBindings::class,

// Route model binding implícito:
// {multa} → Multa::where('id', 123)->firstOrFail()`,
      facts: [['Sesión', 'Redis · SESSION_DRIVER=redis'], ['CSRF', 'no aplica a GET'], ['Consultas SQL', '2 (usuario y multa)'], ['Sin login', '302 → /login']],
      events: [
        { t: 0.019, from: 'middleware', to: 'redis',      type: 'cache',    label: 'GET sesión',     info: 'StartSession: GET laravel_database_laravel_cache:9f2c…' },
        { t: 0.020, from: 'redis',      to: 'middleware', type: 'response', label: 'sesión',         info: 'Sesión encontrada · login_web_59ba… = 7' },
        { t: 0.021, from: 'middleware', to: 'db',         type: 'sql',      label: 'users',          info: 'Authenticate: select * from `users` where `id` = 7 limit 1' },
        { t: 0.023, from: 'db',         to: 'middleware', type: 'response', label: '1 fila',         info: '1 fila · Usuario #7 · 1.4 ms' },
        { t: 0.024, from: 'middleware', to: 'db',         type: 'sql',      label: 'multas',         info: 'SubstituteBindings: select * from `multas` where `id` = 123 limit 1' },
        { t: 0.026, from: 'db',         to: 'middleware', type: 'response', label: 'Multa #123',     info: '1 fila · Multa #123 · 1.8 ms' },
        { t: 0.027, from: 'middleware', to: 'controller', type: 'request',  label: 'show($multa)',   info: 'Llama MultaController@show(Multa $multa)' }
      ]
    },
    {
      title: 'Controlador y Eloquent',
      subtitle: 'La lógica de negocio y las consultas',
      description:
        'El controlador verifica con una Policy que el usuario pueda ver la multa y carga la relación infractor. Eloquent traduce eso a SQL, MySQL devuelve las filas y Eloquent las convierte otra vez en objetos. Cargar relaciones con load() o with() evita el problema N+1.',
      code:
`class MultaController extends Controller
{
    public function show(Multa $multa)
    {
        $this->authorize('view', $multa);   // MultaPolicy@view

        $multa->load('infractor');           // eager loading

        return view('multas.show', compact('multa'));
    }
}`,
      facts: [['Autorización', 'MultaPolicy@view'], ['Relación', 'belongsTo(Infractor)'], ['Evita', 'consultas N+1']],
      events: [
        { t: 0.028, from: 'controller', to: 'model',      type: 'internal', label: "load('infractor')", info: "authorize('view') ✓ · \$multa->load('infractor')" },
        { t: 0.029, from: 'model',      to: 'db',         type: 'sql',      label: 'infractores',       info: 'select * from `infractores` where `infractores`.`id` in (88)' },
        { t: 0.030, from: 'db',         to: 'model',      type: 'response', label: '1 fila',            info: '1 fila · 1.2 ms' },
        { t: 0.031, from: 'model',      to: 'controller', type: 'response', label: 'Multa + infractor', info: 'Modelo hidratado con la relación infractor' }
      ]
    },
    {
      title: 'Vista y respuesta',
      subtitle: 'Blade genera el HTML y la respuesta vuelve',
      description:
        'Blade compila la plantilla a PHP plano (queda en caché en storage/framework/views) y la ejecuta con los datos. La Response vuelve por el mismo pipeline en sentido contrario: el middleware guarda la sesión en Redis y cifra las cookies. Después el Kernel la envía a PHP-FPM, que la entrega a Nginx y este al navegador.',
      code:
`{{-- resources/views/multas/show.blade.php --}}
<x-app-layout>
    <h1>Multa #{{ $multa->id }}</h1>
    <p>Infractor: {{ $multa->infractor->nombre }}</p>
    <p>Valor: {{ Number::currency($multa->valor, 'COP') }}</p>
</x-app-layout>`,
      facts: [['Plantillas compiladas', 'storage/framework/views'], ['Estado', '200 OK'], ['Tamaño', '18 KB (text/html)'], ['Tiempo total', '≈ 47 ms']],
      events: [
        { t: 0.032, from: 'controller', to: 'view',       type: 'internal', label: 'view()',            info: "view('multas.show', compact('multa'))" },
        { t: 0.041, from: 'view',       to: 'middleware', type: 'response', label: 'HTML 18 KB',        info: 'HTML renderizado · 18 KB', size: '18 KB' },
        { t: 0.042, from: 'middleware', to: 'redis',      type: 'cache',    label: 'SET sesión',        info: 'StartSession guarda la sesión · SETEX … 7200' },
        { t: 0.043, from: 'middleware', to: 'kernel',     type: 'response', label: 'Response',          info: 'La Response sube por el pipeline · EncryptCookies cifra la cookie' },
        { t: 0.044, from: 'kernel',     to: 'fpm',        type: 'response', label: 'send()',            info: '$response->send() · cabeceras + cuerpo a stdout' },
        { t: 0.045, from: 'fpm',        to: 'nginx',      type: 'response', label: 'FastCGI stdout',    info: 'FastCGI STDOUT · Status: 200 OK', size: '18 KB' },
        { t: 0.047, from: 'nginx',      to: 'browser',    type: 'response', label: '200 OK',            info: 'HTTP/2 200 OK · text/html; charset=UTF-8 · Set-Cookie: laravel_session', size: '18 KB' }
      ]
    },
    {
      title: 'Terminate',
      subtitle: 'Trabajo después de responder',
      description:
        'El usuario ya tiene su página, pero el proceso PHP sigue vivo unos milisegundos. El Kernel llama a terminate(): corren los middleware terminables, se escriben logs y se ejecutan los jobs despachados con afterResponse(). Lo pesado de verdad (correos, PDFs, integraciones) conviene mandarlo a una cola.',
      code:
`// Un job que corre después de enviar la respuesta
RegistrarConsulta::dispatch($multa, auth()->user())
    ->afterResponse();

// Middleware terminable
public function terminate(Request $request, Response $response): void
{
    Log::info('Multa consultada', ['id' => $request->route('multa')->id]);
}`,
      facts: [['Método', '$kernel->terminate()'], ['Útil para', 'logs, métricas, auditoría'], ['Trabajo pesado', 'mejor en cola (ver escenario Colas)']],
      events: [
        { t: 0.048, from: 'kernel',    to: 'terminate', type: 'internal', label: 'terminate()',  info: 'Middleware terminables · Log::info(…) a storage/logs/laravel.log' },
        { t: 0.050, from: 'terminate', to: 'db',        type: 'sql',      label: 'auditoría',    info: 'afterResponse: insert into `consultas_auditoria` (multa_id, user_id, …)' }
      ]
    }
  ]
});
