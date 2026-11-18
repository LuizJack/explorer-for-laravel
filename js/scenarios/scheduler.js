/*
 * Escenario: tareas programadas (scheduler) en Laravel 11/12.
 * A las 06:00 vencen dos tareas: un comando con withoutOverlapping() y un job.
 */
window.SCENARIOS = window.SCENARIOS || [];
window.SCENARIOS.push({
  id: 'scheduler',
  name: 'Tareas programadas',
  category: 'Segundo plano',
  icon: { kind: 'block', glyph: 'clock', group: 'laravel' },
  tagline: 'Cómo una sola línea de cron ejecuta todas las tareas programadas de la aplicación',
  nodes: [
    { id: 'cron',     label: 'cron',            sub: '* * * * *',          x: 80,  y: 300, group: 'server',   icon: { kind: 'server', glyph: 'clock' } },
    { id: 'artisan',  label: 'schedule:run',    sub: 'php artisan',        x: 260, y: 300, group: 'laravel',  icon: { kind: 'block', glyph: 'terminal' } },
    { id: 'schedule', label: 'Schedule',        sub: 'routes/console.php', x: 260, y: 110, group: 'laravel',  icon: { kind: 'block', glyph: 'calendar' } },
    { id: 'mutex',    label: 'Caché (locks)',   sub: 'withoutOverlapping', x: 480, y: 110, group: 'data',     icon: { kind: 'cylinder', glyph: 'lock' } },
    { id: 'command',  label: 'reportes:diario', sub: 'comando Artisan',    x: 480, y: 300, group: 'laravel',  icon: { kind: 'block', glyph: 'terminal' } },
    { id: 'db',       label: 'MySQL',           sub: 'transito · :3306',   x: 700, y: 300, group: 'data' },
    { id: 'log',      label: 'reportes.log',    sub: 'storage/logs',       x: 480, y: 490, group: 'data',     icon: { kind: 'block', glyph: 'file' } },
    { id: 'queue',    label: 'Redis',           sub: 'queues:default',     x: 260, y: 490, group: 'data',     icon: { kind: 'cylinder', glyph: 'bolt' } },
    { id: 'worker',   label: 'queue:work',      sub: 'proceso worker',     x: 80,  y: 490, group: 'laravel',  icon: { kind: 'server', glyph: 'gear' } },
    { id: 'ping',     label: 'Monitor',         sub: 'hc-ping.com',        x: 880, y: 110, group: 'external', icon: { kind: 'cloud', glyph: 'eye' } }
  ],
  steps: [
    {
      title: 'Cron despierta',
      subtitle: 'Una sola línea, cada minuto',
      description:
        'En el servidor hay una sola entrada de cron para toda la aplicación. Cada minuto ejecuta php artisan schedule:run. Cron no sabe qué tareas existen: solo despierta a Laravel, y Laravel decide. En desarrollo no hace falta cron: php artisan schedule:work hace lo mismo en primer plano.',
      code:
`# crontab -e (con el usuario del servidor web)
* * * * * cd /var/www/app && php artisan schedule:run >> /dev/null 2>&1

# En local, sin cron
php artisan schedule:work`,
      facts: [['Entradas de cron', 'una sola'], ['Frecuencia', 'cada minuto'], ['En desarrollo', 'php artisan schedule:work']],
      events: [
        { t: 0.000, from: 'cron', to: 'artisan', type: 'internal', label: 'schedule:run', info: '06:00:00 · cd /var/www/app && php artisan schedule:run',
          ask: 'Son las 06:00:00 y cron ejecuta su única línea. ¿A quién arranca?' }
      ]
    },
    {
      title: '¿Qué toca a esta hora?',
      subtitle: 'Laravel revisa su agenda',
      description:
        'schedule:run arranca Laravel en modo consola y carga las tareas definidas en routes/console.php. Cada tarea guarda una expresión cron: dailyAt("06:00") equivale a 0 6 * * *. El scheduler compara cada expresión con la hora actual, en la zona horaria indicada, y se queda con las que vencen en este minuto. Si el servidor estaba apagado a esa hora, la tarea se pierde: no se recupera sola.',
      code:
`// routes/console.php (Laravel 11+)
use Illuminate\\Support\\Facades\\Schedule;

Schedule::command('reportes:diario')
    ->dailyAt('06:00')
    ->timezone('America/Bogota');

Schedule::job(new SincronizarSimit)->everyFifteenMinutes();

// Ver la agenda y la próxima ejecución de cada tarea
php artisan schedule:list`,
      facts: [['Definición', 'routes/console.php'], ['Zona horaria', "->timezone('America/Bogota')"], ['Ver la agenda', 'php artisan schedule:list'], ['Ejecuciones perdidas', 'no se recuperan']],
      events: [
        { t: 0.110, from: 'artisan',  to: 'schedule', type: 'internal', label: 'dueEvents()', info: 'Carga routes/console.php y evalúa la expresión cron de cada tarea',
          ask: 'schedule:run ya cargó Laravel. ¿A quién le pregunta qué tareas tocan a las 06:00?' },
        { t: 0.112, from: 'schedule', to: 'artisan',  type: 'response', label: '2 tareas',    info: 'Vencen ahora: reportes:diario (0 6 * * *) y SincronizarSimit (*/15 * * * *)' }
      ]
    },
    {
      title: 'Evitar ejecuciones dobles',
      subtitle: 'Un lock en la caché',
      description:
        'Si el reporte anterior todavía estuviera corriendo, lanzarlo otra vez duplicaría el trabajo. withoutOverlapping() lo evita con un lock en la caché: si el lock ya existe, la tarea se salta. onOneServer() usa la misma idea para que, con varios servidores, solo uno la ejecute; por eso necesita una caché compartida como Redis.',
      code:
`Schedule::command('reportes:diario')
    ->dailyAt('06:00')
    ->withoutOverlapping()     // no arranca si la anterior sigue viva
    ->onOneServer();           // con varios servidores, solo uno la corre

// El lock caduca solo a las 24 horas; se puede acortar (en minutos)
->withoutOverlapping(60)

// Si un lock quedó huérfano tras una caída del servidor
php artisan schedule:clear-cache`,
      facts: [['Mecanismo', 'lock atómico en caché'], ['Caducidad por defecto', '24 horas'], ['onOneServer()', 'requiere caché compartida (Redis, database…)']],
      events: [
        { t: 0.113, from: 'artisan', to: 'mutex',   type: 'cache',    label: 'add(lock)', info: 'withoutOverlapping: Cache::add("framework/schedule-9f2c…", true, 1440 min)',
          ask: 'reportes:diario usa withoutOverlapping(). ¿Dónde comprueba que no haya otra ejecución en curso?' },
        { t: 0.114, from: 'mutex',   to: 'artisan', type: 'response', label: 'lock ✓',    info: 'El lock no existía: se crea y la tarea puede correr' }
      ]
    },
    {
      title: 'Ejecutar el comando',
      subtitle: 'Un proceso PHP aparte',
      description:
        'Cada tarea de tipo comando corre en un proceso PHP aparte. Por defecto van una tras otra: si el reporte tarda 10 minutos, las demás tareas de ese minuto esperan. runInBackground() las lanza en paralelo. El comando hace su trabajo, escribe su salida y termina con un código: 0 significa éxito.',
      code:
`// app/Console/Commands/ReporteDiario.php
class ReporteDiario extends Command
{
    protected $signature = 'reportes:diario';
    protected $description = 'Genera el reporte diario de multas';

    public function handle(): int
    {
        $total = Multa::whereDate('created_at', today()->subDay())->count();

        $this->info("Multas de ayer: {$total}");

        return self::SUCCESS;
    }
}`,
      facts: [['Clase', 'App\\Console\\Commands\\ReporteDiario'], ['Ejecución', 'proceso hijo, en secuencia'], ['En paralelo', '->runInBackground()'], ['Código de salida', '0 = éxito']],
      events: [
        { t: 0.115, from: 'artisan', to: 'command', type: 'internal', label: 'reportes:diario', info: 'Proceso hijo: php artisan reportes:diario >> storage/logs/reportes.log 2>&1',
          ask: 'El lock ya es suyo. ¿Qué arranca ahora schedule:run?' },
        { t: 0.260, from: 'command', to: 'db',      type: 'sql',      label: 'multas',          info: 'select count(*) as aggregate from `multas` where date(`created_at`) = ?',
          ask: 'handle() necesita contar las multas de ayer. ¿A quién consulta?' },
        { t: 0.298, from: 'db',      to: 'command', type: 'response', label: '318',             info: '1 fila · 318 multas · 38 ms' },
        { t: 0.300, from: 'command', to: 'log',     type: 'internal', label: 'salida',          info: 'appendOutputTo: «Multas de ayer: 318» se agrega a reportes.log',
          ask: 'El comando imprime «Multas de ayer: 318». Con appendOutputTo(), ¿dónde queda esa salida?' },
        { t: 0.305, from: 'command', to: 'artisan', type: 'response', label: 'exit 0',          info: 'El proceso hijo termina con código 0 (Command::SUCCESS)' }
      ]
    },
    {
      title: 'Avisos y cierre',
      subtitle: 'Ganchos al terminar la tarea',
      description:
        'Cuando el comando termina, el scheduler ejecuta los ganchos de la tarea. Con pingOnSuccess() avisa a un servicio de monitoreo: si un día el aviso no llega, el monitor te alerta de que el reporte no corrió. Si el comando falla, emailOutputOnFailure() envía la salida por correo. Al final libera el lock.',
      code:
`Schedule::command('reportes:diario')
    ->dailyAt('06:00')
    ->withoutOverlapping()
    ->appendOutputTo(storage_path('logs/reportes.log'))
    ->pingOnSuccess('https://hc-ping.com/tu-uuid')
    ->emailOutputOnFailure('soporte@example.com');`,
      facts: [['Si termina bien', 'onSuccess() · pingOnSuccess()'], ['Si falla', 'onFailure() · emailOutputOnFailure()'], ['Lock', 'se libera al terminar']],
      events: [
        { t: 0.306, from: 'artisan', to: 'ping',    type: 'request',  label: 'GET ping',     info: 'pingOnSuccess: GET https://hc-ping.com/3c1e…',
          ask: 'El comando terminó bien y la tarea tiene pingOnSuccess(). ¿A quién avisa el scheduler?' },
        { t: 0.480, from: 'ping',    to: 'artisan', type: 'response', label: '200 OK',       info: '200 OK · el monitor sabe que el reporte corrió hoy' },
        { t: 0.481, from: 'artisan', to: 'mutex',   type: 'cache',    label: 'forget(lock)', info: 'Libera el lock de withoutOverlapping' }
      ]
    },
    {
      title: 'Jobs programados',
      subtitle: 'El scheduler solo encola',
      description:
        'Schedule::job() no ejecuta el job dentro del scheduler: solo lo pone en la cola, igual que un dispatch(). Lo procesa un worker, con reintentos y registro de fallos. Es la opción adecuada para trabajo pesado: el scheduler queda libre en milisegundos.',
      code:
`// Encola el job cada 15 minutos
Schedule::job(new SincronizarSimit)->everyFifteenMinutes();

// En una cola y una conexión concretas
Schedule::job(new SincronizarSimit, 'integraciones', 'redis')
    ->everyFifteenMinutes();

// También se puede programar un closure
Schedule::call(fn () => Cache::forget('totales'))->hourly();`,
      facts: [['Schedule::job()', 'solo encola'], ['Lo ejecuta', 'queue:work'], ['Ventaja', 'reintentos y failed_jobs']],
      events: [
        { t: 0.482, from: 'artisan', to: 'queue',  type: 'queue', label: 'dispatch', info: 'Schedule::job(new SincronizarSimit): RPUSH queues:default {…}', size: '760 B',
          ask: 'La otra tarea es Schedule::job(new SincronizarSimit). ¿A dónde la envía el scheduler?' },
        { t: 0.520, from: 'queue',   to: 'worker', type: 'queue', label: 'job',      info: 'Un worker toma SincronizarSimit y ejecuta handle() (ver el proceso «Colas»)' }
      ]
    }
  ],
  quiz: [
    {
      q: '¿Cuántas entradas de cron necesita el servidor para todas las tareas programadas de Laravel?',
      options: [
        'Una sola, que ejecuta schedule:run cada minuto',
        'Una por cada tarea programada',
        'Una por cada frecuencia distinta (diaria, cada hora…)',
        'Ninguna: Laravel se despierta solo'
      ],
      answer: 0,
      explain: 'Cron solo despierta a Laravel cada minuto. Las tareas y sus horarios viven en el código (routes/console.php), no en el crontab.',
      nodes: ['cron', 'artisan']
    },
    {
      q: '¿Qué hace withoutOverlapping()?',
      options: [
        'Evita que la tarea arranque si su ejecución anterior sigue corriendo',
        'Hace que la tarea corra en paralelo con las demás',
        'Reintenta la tarea si falla',
        'Impide que dos tareas distintas coincidan en el mismo minuto'
      ],
      answer: 0,
      explain: 'Crea un lock en la caché mientras la tarea corre. Si en el siguiente ciclo el lock sigue ahí, esa tarea se salta.',
      nodes: ['mutex']
    },
    {
      q: 'Programaste Schedule::job(new SincronizarSimit). ¿Quién ejecuta el job?',
      options: [
        'Un worker de la cola; el scheduler solo lo encola',
        'El propio schedule:run, antes de terminar',
        'Cron, en una segunda línea del crontab',
        'El navegador del siguiente usuario que entre'
      ],
      answer: 0,
      explain: 'Schedule::job() equivale a un dispatch() a la hora indicada. Sin un worker (queue:work) corriendo, el job se queda esperando en la cola.',
      nodes: ['queue', 'worker']
    },
    {
      q: 'Tienes tres servidores con el mismo cron. ¿Cómo evitas que el reporte se genere tres veces?',
      options: [
        'Con onOneServer() y una caché compartida entre los servidores',
        'Con withoutOverlapping() y la caché en archivos de cada servidor',
        'Poniendo un sleep distinto en cada servidor',
        'No se puede: hay que dejar el cron en un solo servidor'
      ],
      answer: 0,
      explain: 'onOneServer() toma un lock por tarea y minuto en la caché. Solo el primer servidor que lo consigue ejecuta la tarea, y por eso la caché debe ser común (Redis, base de datos, Memcached).',
      nodes: ['mutex', 'artisan']
    },
    {
      q: 'El servidor estuvo apagado de 05:50 a 06:10. ¿Qué pasa con la tarea de las 06:00?',
      options: [
        'No se ejecuta: el scheduler no recupera ejecuciones perdidas',
        'Se ejecuta en cuanto el servidor enciende',
        'Se ejecuta dos veces al día siguiente',
        'Queda en failed_jobs para reintentarla'
      ],
      answer: 0,
      explain: 'Cada minuto, schedule:run solo mira qué vence en ese minuto. Por eso conviene vigilar las tareas importantes con un aviso como pingOnSuccess().',
      nodes: ['schedule', 'ping']
    }
  ]
});
