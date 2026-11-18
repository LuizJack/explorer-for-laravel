/*
 * Escenario: API con tokens de Laravel Sanctum (Laravel 11/12).
 * Una app móvil pide un token, lo usa para consultar /api/multas y luego lo revoca.
 */
window.SCENARIOS = window.SCENARIOS || [];
window.SCENARIOS.push({
  id: 'sanctum',
  name: 'API con Sanctum',
  category: 'Seguridad',
  icon: { kind: 'block', glyph: 'lock', group: 'laravel' },
  tagline: 'Cómo una app móvil se identifica con un token en lugar de una sesión',
  nodes: [
    { id: 'app',        label: 'App móvil',       sub: 'agente en vía',      x: 100, y: 300, group: 'client',  icon: { kind: 'phone' } },
    { id: 'api',        label: 'Middleware api',  sub: 'routes/api.php',     x: 360, y: 300, group: 'laravel', icon: { kind: 'stack', glyph: 'layers' } },
    { id: 'throttle',   label: 'RateLimiter',     sub: 'throttle:api',       x: 360, y: 110, group: 'data',    icon: { kind: 'cylinder', glyph: 'shield' } },
    { id: 'tokenctl',   label: 'TokenController', sub: '@store · @destroy',  x: 620, y: 110, group: 'laravel', icon: { kind: 'block', glyph: 'key' } },
    { id: 'hash',       label: 'Hasher',          sub: 'bcrypt · cost 12',   x: 880, y: 110, group: 'laravel' },
    { id: 'guard',      label: 'Guard sanctum',   sub: 'auth:sanctum',       x: 620, y: 300, group: 'laravel', icon: { kind: 'block', glyph: 'lock' } },
    { id: 'db',         label: 'MySQL',           sub: 'users · tokens',     x: 880, y: 300, group: 'data' },
    { id: 'controller', label: 'MultaController', sub: '@index',             x: 620, y: 490, group: 'laravel' },
    { id: 'resource',   label: 'MultaResource',   sub: 'JSON',               x: 360, y: 490, group: 'laravel', icon: { kind: 'block', glyph: 'braces' } }
  ],
  steps: [
    {
      title: 'La app pide un token',
      subtitle: 'Sin cookies ni sesión',
      description:
        'Una app móvil no usa cookies ni sesión como el navegador. Para identificarse pide un token: envía correo, contraseña y un nombre de dispositivo. Las rutas de routes/api.php pasan por el grupo de middleware api, que no arranca sesión ni valida CSRF. Si lo activas con throttleApi(), también limita cuántas peticiones acepta por minuto.',
      code:
`// routes/api.php (todas llevan el prefijo /api)
Route::post('/login', [TokenController::class, 'store']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/multas', [MultaController::class, 'index'])
        ->middleware('ability:multas:leer');
    Route::post('/logout', [TokenController::class, 'destroy']);
});

// bootstrap/app.php
->withMiddleware(function (Middleware $middleware) {
    $middleware->throttleApi();
    $middleware->alias([
        'ability' => CheckForAnyAbility::class,
        'abilities' => CheckAbilities::class,
    ]);
})

// AppServiceProvider::boot(): el límite llamado "api"
RateLimiter::for('api', fn (Request $request) =>
    Limit::perMinute(60)->by($request->user()?->id ?: $request->ip()));`,
      facts: [['Instalación', 'php artisan install:api'], ['Rutas', 'routes/api.php · prefijo /api'], ['Estado', 'sin sesión, sin cookies, sin CSRF'], ['Límite', '60 peticiones por minuto']],
      events: [
        { t: 0.000, from: 'app',      to: 'api',      type: 'request',  label: 'POST /api/login', info: 'POST /api/login · email, password, device_name="celular-agente-07"', size: '412 B' },
        { t: 0.004, from: 'api',      to: 'throttle', type: 'cache',    label: 'throttle',        info: 'throttle:api · ¿cuántas peticiones lleva esta IP en el último minuto?',
          ask: 'El grupo api limita cuántas peticiones acepta por minuto. ¿Dónde lleva la cuenta?' },
        { t: 0.005, from: 'throttle', to: 'api',      type: 'response', label: '1 / 60',          info: '1 de 60 peticiones este minuto → pasa' },
        { t: 0.006, from: 'api',      to: 'tokenctl', type: 'request',  label: 'store()',         info: 'TokenController@store · sin sesión, sin cookies, sin CSRF' }
      ]
    },
    {
      title: 'Verificar y emitir el token',
      subtitle: 'Se guarda el hash, no el token',
      description:
        'El controlador busca al usuario y verifica la contraseña, igual que en un login normal. Si coincide, createToken() genera una cadena aleatoria. A la app le entrega el texto plano una única vez; en la base de datos guarda solo su hash SHA-256. Así, aunque alguien robe la tabla, no puede usar los tokens. El token también lleva sus habilidades: qué se le permite hacer.',
      code:
`class TokenController extends Controller
{
    public function store(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required',
            'device_name' => 'required',
        ]);

        $user = User::where('email', $request->email)->first();

        if (! $user || ! Hash::check($request->password, $user->password)) {
            throw ValidationException::withMessages([
                'email' => ['Las credenciales no son correctas.'],
            ]);
        }

        $token = $user->createToken($request->device_name, ['multas:leer']);

        return ['token' => $token->plainTextToken];
    }
}`,
      facts: [['Tabla', 'personal_access_tokens'], ['Se guarda', 'hash SHA-256 del token'], ['Formato entregado', 'id|texto → 15|Xk2pQ…'], ['Habilidades', '["multas:leer"]']],
      events: [
        { t: 0.008, from: 'tokenctl', to: 'db',       type: 'sql',      label: 'users',         info: 'select * from `users` where `email` = ? limit 1' },
        { t: 0.010, from: 'db',       to: 'tokenctl', type: 'response', label: '1 fila',        info: '1 fila · Usuario #7 · password=$2y$12$Qm…' },
        { t: 0.011, from: 'tokenctl', to: 'hash',     type: 'request',  label: 'Hash::check()', info: 'Hash::check($request->password, $user->password)',
          ask: 'Ya tiene al usuario y su hash. ¿Quién compara la contraseña enviada con ese hash?' },
        { t: 0.211, from: 'hash',     to: 'tokenctl', type: 'response', label: 'true ✓',        info: 'Contraseña correcta · ≈ 200 ms (bcrypt cost 12)' },
        { t: 0.212, from: 'tokenctl', to: 'db',       type: 'sql',      label: 'insert token',  info: 'insert into `personal_access_tokens` (tokenable_id, name, token, abilities) values (7, ?, <sha256 del token>, ["multas:leer"])',
          ask: 'Credenciales correctas. createToken() genera un token aleatorio. ¿Dónde guarda su hash?' },
        { t: 0.215, from: 'db',       to: 'tokenctl', type: 'response', label: 'id 15',         info: '1 fila insertada · id = 15' },
        { t: 0.217, from: 'tokenctl', to: 'app',      type: 'response', label: '200 + token',   info: '200 OK · {"token":"15|Xk2pQ…"} · el texto plano solo se entrega esta vez', size: '96 B' }
      ]
    },
    {
      title: 'Usar el token',
      subtitle: 'Cada petición se identifica sola',
      description:
        'Desde ahora la app envía el token en la cabecera Authorization de cada petición. No hay cookie de sesión: cada petición se identifica por sí misma. La ruta está protegida con auth:sanctum, que le pide al guard de Sanctum averiguar a quién pertenece el token.',
      code:
`GET /api/multas HTTP/1.1
Host: app.transito.gov.co
Authorization: Bearer 15|Xk2pQ7cR…
Accept: application/json

# Con Accept: application/json, un error de autenticación
# llega como JSON (401) y no como una redirección a /login.`,
      facts: [['Cabecera', 'Authorization: Bearer <token>'], ['Accept', 'application/json'], ['Middleware', 'auth:sanctum']],
      events: [
        { t: 2.000, from: 'app', to: 'api',   type: 'request', label: 'GET /api/multas', info: 'GET /api/multas · Authorization: Bearer 15|Xk2pQ… · Accept: application/json', size: '388 B' },
        { t: 2.004, from: 'api', to: 'guard', type: 'request', label: 'auth:sanctum',    info: 'throttle ✓ · el middleware auth:sanctum pide al guard identificar al usuario',
          ask: 'Llega GET /api/multas con un token Bearer. ¿Quién debe averiguar de quién es ese token?' }
      ]
    },
    {
      title: 'Validar el token',
      subtitle: 'Buscar, comparar y cargar al dueño',
      description:
        'El guard separa el token en id y texto. Busca el registro por id y compara el hash guardado con el SHA-256 del texto recibido usando hash_equals(), que tarda lo mismo acierte o falle y así no da pistas. Luego revisa que no esté vencido, carga al usuario dueño y anota la fecha de último uso. Por último, el middleware ability comprueba que el token tenga la habilidad que la ruta exige.',
      code:
`// config/sanctum.php: vigencia en minutos (null = no vencen)
'expiration' => 60 * 24 * 30,

// O una fecha de vencimiento por token
$user->createToken('celular', ['multas:leer'], now()->addDays(30));

// Comprobar habilidades
$request->user()->tokenCan('multas:leer');     // en el código
->middleware('ability:multas:leer')            // en la ruta

// Borrar tokens vencidos (conviene programarlo a diario)
php artisan sanctum:prune-expired --hours=24`,
      facts: [['Comparación', 'hash_equals(), en tiempo constante'], ['Vencimiento', 'sanctum.expiration o expires_at'], ['Sin la habilidad', '403 Forbidden'], ['Consultas SQL', '3 por petición']],
      events: [
        { t: 2.005, from: 'guard', to: 'db',         type: 'sql',      label: 'token 15',     info: 'select * from `personal_access_tokens` where `id` = 15 limit 1',
          ask: 'El guard separa «15|Xk2pQ…» en id y texto. ¿Dónde busca el registro 15?' },
        { t: 2.007, from: 'db',    to: 'guard',      type: 'response', label: '1 fila',       info: '1 fila · hash_equals(hash guardado, sha256("Xk2pQ…")) = true · no está vencido' },
        { t: 2.008, from: 'guard', to: 'db',         type: 'sql',      label: 'users',        info: 'select * from `users` where `id` = 7 limit 1' },
        { t: 2.010, from: 'db',    to: 'guard',      type: 'response', label: 'Usuario #7',   info: '1 fila · el dueño del token' },
        { t: 2.011, from: 'guard', to: 'db',         type: 'sql',      label: 'last_used_at', info: 'update `personal_access_tokens` set `last_used_at` = ? where `id` = 15' },
        { t: 2.013, from: 'guard', to: 'controller', type: 'request',  label: 'index()',      info: 'Usuario autenticado · ability:multas:leer ✓ → MultaController@index',
          ask: 'Token válido y con la habilidad multas:leer. ¿A quién le pasa ahora la petición?' }
      ]
    },
    {
      title: 'Responder en JSON',
      subtitle: 'Un API Resource da forma a los datos',
      description:
        'El controlador trabaja como siempre: $request->user() ya es el agente dueño del token. En una API no se devuelve una vista sino JSON. Un API Resource decide qué campos se exponen y con qué nombres, de modo que la estructura interna de la tabla no se filtra al exterior. Con paginate(), la respuesta incluye los enlaces y los datos de paginación.',
      code:
`class MultaController extends Controller
{
    public function index(Request $request)
    {
        return MultaResource::collection(
            $request->user()->multas()->latest()->paginate(20)
        );
    }
}

class MultaResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'placa' => $this->placa,
            'valor' => $this->valor,
            'fecha' => $this->created_at->toIso8601String(),
        ];
    }
}`,
      facts: [['Usuario', '$request->user()'], ['Salida', 'JsonResource'], ['Paginación', 'links y meta incluidos'], ['Tiempo total', '≈ 24 ms']],
      events: [
        { t: 2.014, from: 'controller', to: 'db',         type: 'sql',      label: 'multas',       info: 'select * from `multas` where `agente_id` = 7 order by `created_at` desc limit 20 offset 0' },
        { t: 2.019, from: 'db',         to: 'controller', type: 'response', label: '20 filas',     info: '20 filas · 4.6 ms' },
        { t: 2.020, from: 'controller', to: 'resource',   type: 'internal', label: 'collection()', info: 'MultaResource::collection($multas) · elige qué campos se exponen',
          ask: 'El controlador tiene 20 modelos Multa. ¿Quién decide qué campos salen en el JSON?' },
        { t: 2.024, from: 'resource',   to: 'app',        type: 'response', label: '200 JSON',     info: '200 OK · {"data":[{"id":124,"placa":"ABC123",…}],"links":{…},"meta":{…}}', size: '6.2 KB' }
      ]
    },
    {
      title: 'Revocar el token',
      subtitle: 'Cerrar sesión es borrar una fila',
      description:
        'Cerrar sesión en una API es borrar el token. Al no existir el registro, cualquier petición posterior con ese token recibe un 401, aunque el texto sea correcto. Como hay un token por dispositivo, se pueden revocar uno por uno: si un agente pierde el celular, se borra solo el token de ese equipo.',
      code:
`class TokenController extends Controller
{
    public function destroy(Request $request)
    {
        // Solo este dispositivo
        $request->user()->currentAccessToken()->delete();

        return response()->noContent();
    }
}

// Todos los dispositivos del usuario
$user->tokens()->delete();

// Un dispositivo concreto
$user->tokens()->where('name', 'celular-agente-07')->delete();`,
      facts: [['Revocar', 'borrar la fila del token'], ['Token revocado', '401 Unauthenticated'], ['Alcance', 'un token por dispositivo']],
      events: [
        { t: 9.000,  from: 'app',      to: 'api',      type: 'request',  label: 'POST /api/logout', info: 'POST /api/logout · Authorization: Bearer 15|Xk2pQ…', size: '352 B' },
        { t: 9.006,  from: 'api',      to: 'tokenctl', type: 'request',  label: 'destroy()',        info: 'auth:sanctum ✓ → TokenController@destroy' },
        { t: 9.007,  from: 'tokenctl', to: 'db',       type: 'sql',      label: 'delete token',     info: 'delete from `personal_access_tokens` where `id` = 15',
          ask: 'El agente cierra sesión. currentAccessToken()->delete() ¿dónde borra el token?' },
        { t: 9.009,  from: 'db',       to: 'tokenctl', type: 'response', label: '1 fila',           info: '1 fila eliminada · el token deja de existir' },
        { t: 9.010,  from: 'tokenctl', to: 'app',      type: 'response', label: '204',              info: '204 No Content' },
        { t: 15.000, from: 'app',      to: 'api',      type: 'request',  label: 'GET /api/multas',  info: 'Alguien reutiliza el token viejo: Authorization: Bearer 15|Xk2pQ…', size: '388 B' },
        { t: 15.004, from: 'api',      to: 'app',      type: 'error',    label: '401',              info: 'auth:sanctum ya no encuentra el token 15 → 401 {"message":"Unauthenticated."}',
          ask: 'El token 15 ya no existe en la base de datos. ¿A quién le responde el middleware con un 401?' }
      ]
    }
  ],
  quiz: [
    {
      q: '¿Cómo queda guardado el token en la base de datos?',
      options: [
        'Como un hash SHA-256; el texto plano solo se entrega una vez',
        'En texto plano, para poder mostrarlo de nuevo',
        'Cifrado con APP_KEY, para poder descifrarlo después',
        'No se guarda: se valida con una firma, como un JWT'
      ],
      answer: 0,
      explain: 'Sanctum guarda solo el hash. Si alguien roba la tabla personal_access_tokens, no obtiene tokens utilizables. Por lo mismo, si el usuario pierde su token hay que emitir uno nuevo.',
      nodes: ['tokenctl', 'db']
    },
    {
      q: '¿Por qué una petición con token Bearer no necesita token CSRF?',
      options: [
        'Porque no depende de cookies que el navegador envíe por su cuenta',
        'Porque las API siempre usan HTTPS',
        'Porque Sanctum agrega el token CSRF automáticamente',
        'Porque el método GET nunca lo necesita y las API solo usan GET'
      ],
      answer: 0,
      explain: 'Un ataque CSRF aprovecha que el navegador adjunta la cookie de sesión sin que el usuario lo sepa. Un token Bearer hay que ponerlo a propósito en la cabecera, así que otro sitio no puede usarlo.',
      nodes: ['app', 'api']
    },
    {
      q: 'El token solo tiene la habilidad multas:leer y llama a una ruta protegida con ability:multas:borrar. ¿Qué recibe?',
      options: [
        '403 Forbidden: está autenticado, pero no tiene permiso',
        '401 Unauthenticated: el token no es válido',
        '404 Not Found: la ruta se oculta',
        '200 OK: las habilidades son solo informativas'
      ],
      answer: 0,
      explain: 'El token es válido, así que el usuario sí está identificado (no es un 401). Lo que falta es la habilidad, y eso es un problema de permisos: 403.',
      nodes: ['guard']
    },
    {
      q: '¿Qué hace $user->tokens()->delete()?',
      options: [
        'Revoca todos los tokens del usuario: cierra sesión en todos sus dispositivos',
        'Borra solo el token de la petición actual',
        'Borra los tokens vencidos de todos los usuarios',
        'Elimina al usuario y sus tokens'
      ],
      answer: 0,
      explain: 'tokens() es la relación con todos los tokens del usuario. Para cerrar sesión solo en el dispositivo actual se usa currentAccessToken()->delete().',
      nodes: ['tokenctl', 'db']
    },
    {
      q: '¿Qué pasa cuando llega una petición con un token que ya fue revocado?',
      options: [
        'auth:sanctum no encuentra el registro y responde 401',
        'Funciona hasta que el token venza por tiempo',
        'Laravel emite un token nuevo automáticamente',
        'Redirige a la página de login con un 302'
      ],
      answer: 0,
      explain: 'Cada petición busca el token en la base de datos. Si la fila no existe, no hay usuario y la respuesta es 401. Por eso revocar es inmediato.',
      nodes: ['guard', 'db', 'app']
    }
  ]
});
