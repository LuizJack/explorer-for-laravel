/*
 * Escenario: un job en cola con Redis, con un fallo y un reintento.
 */
window.SCENARIOS = window.SCENARIOS || [];
window.SCENARIOS.push({
  id: 'queue',
  name: 'Colas (jobs)',
  tagline: 'Cómo un correo sale en segundo plano sin hacer esperar al usuario',
  nodes: [
    { id: 'browser',    label: 'Navegador',          sub: 'POST /multas',          x: 80,  y: 300, group: 'client' },
    { id: 'controller', label: 'MultaController',    sub: '@store',                x: 240, y: 300, group: 'laravel' },
    { id: 'bus',        label: 'Bus',                sub: 'Dispatcher',            x: 400, y: 300, group: 'laravel' },
    { id: 'redis',      label: 'Redis',              sub: 'queues:default',        x: 560, y: 300, group: 'data' },
    { id: 'supervisor', label: 'Supervisor',         sub: 'reinicia el worker', x: 720, y: 110, group: 'server' },
    { id: 'worker',     label: 'queue:work',         sub: 'proceso worker',        x: 720, y: 300, group: 'laravel' },
    { id: 'job',        label: 'NotificarMulta',     sub: 'ShouldQueue', x: 880, y: 300, group: 'laravel' },
    { id: 'failed',     label: 'failed_jobs',        sub: 'tabla de fallidos',     x: 560, y: 490, group: 'data' },
    { id: 'db',         label: 'MySQL',              sub: 'transito · :3306',      x: 720, y: 490, group: 'data' },
    { id: 'smtp',       label: 'Servidor SMTP',      sub: 'smtp.mailgun.org:587',  x: 880, y: 490, group: 'external' }
  ],
  steps: [
    {
      title: 'Despachar el job',
      subtitle: 'El controlador encola y responde de inmediato',
      description:
        'Al registrar una multa, el controlador no envía el correo: despacha el job NotificarMulta. El Dispatcher serializa el job a JSON (el modelo se guarda solo como clase + id, no completo) y lo empuja a la lista queues:default en Redis. El usuario recibe la respuesta en milisegundos.',
      code:
`class NotificarMulta implements ShouldQueue
{
    use Queueable;

    public $tries = 3;
    public $backoff = [10, 60];

    public function __construct(public Multa $multa) {}
}

// En el controlador
NotificarMulta::dispatch($multa);
return redirect()->route('multas.show', $multa);`,
      facts: [['Driver', 'QUEUE_CONNECTION=redis'], ['Cola', 'default'], ['Modelo serializado como', 'ModelIdentifier (clase + id)'], ['Respuesta al usuario', '≈ 35 ms']],
      events: [
        { t: 0.000, from: 'browser',    to: 'controller', type: 'request',  label: 'POST /multas',   info: 'POST /multas · placa=ABC123, infraccion=C29', size: '1.4 KB' },
        { t: 0.022, from: 'controller', to: 'bus',        type: 'queue',    label: 'dispatch()',     info: 'NotificarMulta::dispatch($multa)' },
        { t: 0.024, from: 'bus',        to: 'redis',      type: 'queue',    label: 'RPUSH',          info: 'RPUSH queues:default {"uuid":"7c1e…","displayName":"App\\\\Jobs\\\\NotificarMulta","attempts":0}', size: '890 B' },
        { t: 0.035, from: 'controller', to: 'browser',    type: 'response', label: '302 Found',      info: '302 → /multas/124 (el correo aún no se ha enviado)' }
      ]
    },
    {
      title: 'El worker toma el job',
      subtitle: 'Un proceso que vive escuchando la cola',
      description:
        'php artisan queue:work es un proceso de larga duración: carga Laravel una vez y queda esperando trabajos. Supervisor lo mantiene vivo y lo reinicia si se cae. El worker saca el job de la cola y lo mueve a una lista de "reservados" para que ningún otro worker lo procese al mismo tiempo.',
      code:
`; /etc/supervisor/conf.d/laravel-worker.conf
[program:laravel-worker]
command=php /var/www/app/artisan queue:work redis --sleep=3 --tries=3 --max-time=3600
numprocs=2
autostart=true
autorestart=true
user=www-data

# Después de cada deploy
php artisan queue:restart`,
      facts: [['Proceso', 'larga duración (no por petición)'], ['Reservado en', 'queues:default:reserved'], ['Tras un deploy', 'php artisan queue:restart']],
      events: [
        { t: 0.400, from: 'supervisor', to: 'worker', type: 'internal', label: 'mantener vivo',  info: 'Supervisor mantiene 2 procesos queue:work en ejecución' },
        { t: 0.410, from: 'worker',     to: 'redis',  type: 'queue',    label: 'pop',            info: 'Script Lua: LPOP queues:default → ZADD queues:default:reserved' },
        { t: 0.411, from: 'redis',      to: 'worker', type: 'response', label: 'job (intento 1)', info: 'Payload NotificarMulta · attempts=1' }
      ]
    },
    {
      title: 'Ejecutar handle()',
      subtitle: 'El job reconstruye el modelo y trabaja',
      description:
        'El worker deserializa el job. Como el modelo se guardó solo con su id, Laravel lo vuelve a buscar en la base de datos: así el job siempre trabaja con datos frescos. Luego llama a handle(), que intenta enviar el correo por SMTP.',
      code:
`public function handle(): void
{
    Mail::to($this->multa->infractor->email)
        ->send(new MultaRegistrada($this->multa));
}`,
      facts: [['Rehidratación', 'Multa::findOrFail(124)'], ['Método', 'handle()'], ['Transporte', 'MAIL_MAILER=smtp']],
      events: [
        { t: 0.412, from: 'worker', to: 'job',  type: 'internal', label: 'handle()',  info: 'Deserializa el job y llama a handle()' },
        { t: 0.413, from: 'job',    to: 'db',   type: 'sql',      label: 'multas',    info: 'select * from `multas` where `id` = 124 limit 1' },
        { t: 0.415, from: 'db',     to: 'job',  type: 'response', label: '1 fila',    info: '1 fila · Multa #124 · 1.6 ms' },
        { t: 0.420, from: 'job',    to: 'smtp', type: 'request',  label: 'SMTP',      info: 'EHLO app.transito.gov.co · STARTTLS · MAIL FROM' }
      ]
    },
    {
      title: 'Falla y reintento',
      subtitle: 'El servidor de correo no responde',
      description:
        'El SMTP no contesta y la conexión expira. El job lanza una excepción; como todavía le quedan intentos ($tries = 3), el worker lo devuelve a la cola con un retraso ($backoff = 10 s). No se pierde nada: simplemente espera y se vuelve a intentar.',
      code:
`public $tries = 3;
public $backoff = [10, 60];   // 10 s, luego 60 s

// Ver jobs fallidos y reintentarlos
php artisan queue:failed
php artisan queue:retry all`,
      facts: [['Error', 'Connection timed out'], ['Intento', '1 de 3'], ['Reintento en', '10 segundos'], ['Programado en', 'queues:default:delayed']],
      events: [
        { t: 30.42, from: 'smtp',   to: 'job',    type: 'error', label: 'timeout ✗',    info: 'TransportException: Connection to smtp.mailgun.org:587 timed out' },
        { t: 30.43, from: 'job',    to: 'worker', type: 'error', label: 'Exception',    info: 'El job lanza la excepción al worker (attempts=1 < tries=3)' },
        { t: 30.44, from: 'worker', to: 'redis',  type: 'queue', label: 'release(10)',  info: 'ZREM reserved · ZADD queues:default:delayed (ahora + 10 s)' }
      ]
    },
    {
      title: 'Segundo intento',
      subtitle: 'Esta vez el correo sale',
      description:
        'Pasados los 10 segundos, el job vuelve a estar disponible. Un worker lo toma de nuevo, handle() se ejecuta otra vez y ahora el servidor SMTP acepta el mensaje. Por eso los jobs deben ser idempotentes: ejecutarlos dos veces no debe causar efectos duplicados.',
      code:
`// Idea: marcar para no notificar dos veces
public function handle(): void
{
    if ($this->multa->notificada_at) {
        return;
    }

    Mail::to(...)->send(new MultaRegistrada($this->multa));
    $this->multa->update(['notificada_at' => now()]);
}`,
      facts: [['Intento', '2 de 3'], ['Respuesta SMTP', '250 OK queued'], ['Principio', 'jobs idempotentes']],
      events: [
        { t: 40.45, from: 'redis',  to: 'worker', type: 'response', label: 'job (intento 2)', info: 'migrate delayed → queues:default · pop · attempts=2' },
        { t: 40.46, from: 'worker', to: 'job',    type: 'internal', label: 'handle()',        info: 'Nuevo intento de handle()' },
        { t: 40.47, from: 'job',    to: 'smtp',   type: 'request',  label: 'SMTP',            info: 'MAIL FROM · RCPT TO · DATA (MultaRegistrada)', size: '24 KB' },
        { t: 41.10, from: 'smtp',   to: 'job',    type: 'response', label: '250 OK',          info: '250 2.0.0 OK queued as 8F3A2C' },
        { t: 41.11, from: 'job',    to: 'db',     type: 'sql',      label: 'notificada_at',   info: 'update `multas` set `notificada_at` = now() where `id` = 124' }
      ]
    },
    {
      title: 'Confirmación',
      subtitle: 'El job se borra de la cola',
      description:
        'Como handle() terminó sin excepciones, el worker elimina el job de la lista de reservados y queda libre para el siguiente. Si hubiera fallado en los 3 intentos, el job no se pierde: se guarda en la tabla failed_jobs con la excepción completa, para revisarlo y reintentarlo después.',
      code:
`// Se ejecuta si se agotan los intentos
public function failed(?Throwable $exception): void
{
    Log::error('No se pudo notificar la multa', [
        'multa' => $this->multa->id,
        'error' => $exception?->getMessage(),
    ]);
}`,
      facts: [['Resultado', 'procesado ✓'], ['Si agota intentos', 'fila en failed_jobs'], ['Monitoreo', 'Laravel Horizon']],
      events: [
        { t: 41.12, from: 'job',    to: 'worker', type: 'response', label: 'OK',              info: 'handle() terminó sin excepciones' },
        { t: 41.13, from: 'worker', to: 'redis',  type: 'queue',    label: 'ZREM reserved',   info: 'Job eliminado de queues:default:reserved · worker libre' },
        { t: 41.13, from: 'worker', to: 'failed', type: 'error', optional: true, label: '(solo si falla)', info: 'Ruta alternativa: tras 3 fallos → insert into `failed_jobs` + failed()' }
      ]
    }
  ]
});
