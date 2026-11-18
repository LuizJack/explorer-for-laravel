/*
 * Escenario: eventos y listeners (Laravel 11/12).
 * Al registrar una multa se dispara MultaRegistrada, con un listener síncrono,
 * un listener en cola y difusión en tiempo real con Reverb.
 */
window.SCENARIOS = window.SCENARIOS || [];
window.SCENARIOS.push({
  id: 'events',
  name: 'Eventos y listeners',
  category: 'Arquitectura',
  icon: { kind: 'block', glyph: 'bell', group: 'laravel' },
  tagline: 'Un evento, tres reacciones: una inmediata, una en cola y una en tiempo real',
  nodes: [
    { id: 'browser',    label: 'Navegador',          sub: 'POST /multas',      x: 80,  y: 300, group: 'client' },
    { id: 'controller', label: 'MultaController',    sub: '@store',            x: 240, y: 300, group: 'laravel' },
    { id: 'db',         label: 'MySQL',              sub: 'transito · :3306',  x: 240, y: 490, group: 'data' },
    { id: 'dispatcher', label: 'Dispatcher',         sub: 'eventos',           x: 400, y: 300, group: 'laravel',  icon: { kind: 'block', glyph: 'bell' } },
    { id: 'sync',       label: 'ActualizarTotales',  sub: 'listener síncrono', x: 400, y: 490, group: 'laravel',  icon: { kind: 'block', glyph: 'chart' } },
    { id: 'redis',      label: 'Redis',              sub: 'queues:default',    x: 560, y: 300, group: 'data' },
    { id: 'worker',     label: 'queue:work',         sub: 'proceso worker',    x: 720, y: 300, group: 'laravel' },
    { id: 'queued',     label: 'NotificarInfractor', sub: 'listener en cola',  x: 720, y: 110, group: 'laravel',  icon: { kind: 'block', glyph: 'mail' } },
    { id: 'smtp',       label: 'Servidor SMTP',      sub: 'smtp.mailgun.org',  x: 880, y: 110, group: 'external' },
    { id: 'reverb',     label: 'Reverb',             sub: 'WebSockets :8080',  x: 720, y: 490, group: 'server',   icon: { kind: 'server', glyph: 'broadcast' } },
    { id: 'dashboard',  label: 'Panel en vivo',      sub: 'otro navegador',    x: 880, y: 490, group: 'client',   icon: { kind: 'laptop' } }
  ],
  steps: [
    {
      title: 'Se registra la multa',
      subtitle: 'El controlador guarda y nada más',
      description:
        'El agente registra una multa. El controlador valida los datos y la guarda. Pero cuando una multa se registra deben pasar más cosas: actualizar los totales del día, avisar al infractor y refrescar el panel de control. Meter todo eso en el controlador lo volvería largo y frágil.',
      code:
`class MultaController extends Controller
{
    public function store(StoreMultaRequest $request)
    {
        $multa = Multa::create($request->validated());

        MultaRegistrada::dispatch($multa);

        return redirect()->route('multas.show', $multa);
    }
}`,
      facts: [['Ruta', 'POST /multas'], ['Validación', 'StoreMultaRequest'], ['Idea', 'el controlador solo anuncia qué pasó']],
      events: [
        { t: 0.000, from: 'browser',    to: 'controller', type: 'request',  label: 'POST /multas',  info: 'POST /multas · placa=ABC123, infraccion=C29', size: '1.4 KB' },
        { t: 0.018, from: 'controller', to: 'db',         type: 'sql',      label: 'insert multas', info: 'insert into `multas` (placa, infraccion_id, agente_id, …) values (?, ?, ?, …)',
          ask: 'El agente envió el formulario. Antes de avisarle a nadie, ¿dónde guarda el controlador la multa?' },
        { t: 0.021, from: 'db',         to: 'controller', type: 'response', label: 'id 124',        info: '1 fila insertada · id = 124 · 2.9 ms' }
      ]
    },
    {
      title: 'Se dispara el evento',
      subtitle: 'El controlador anuncia un hecho',
      description:
        'El controlador no llama a nadie directamente: anuncia un hecho con un evento. Un evento es un objeto simple con los datos de lo que ocurrió. El Dispatcher busca qué listeners están interesados. Desde Laravel 11 no hay que registrarlos a mano: los descubre en app/Listeners por el tipo del parámetro de handle().',
      code:
`// app/Events/MultaRegistrada.php
class MultaRegistrada implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public Multa $multa) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('multas')];
    }
}

// Ver qué listeners tiene cada evento
php artisan event:list`,
      facts: [['Clase', 'App\\Events\\MultaRegistrada'], ['Descubrimiento', 'automático en app/Listeners'], ['Ver el mapa', 'php artisan event:list']],
      events: [
        { t: 0.022, from: 'controller', to: 'dispatcher', type: 'internal', label: 'MultaRegistrada', info: 'MultaRegistrada::dispatch($multa)',
          ask: 'La multa ya existe. MultaRegistrada::dispatch($multa) ¿a quién le entrega el evento?' }
      ]
    },
    {
      title: 'Listener síncrono',
      subtitle: 'Corre dentro de la misma petición',
      description:
        'Un listener normal se ejecuta de inmediato, dentro de la misma petición. Sirve para trabajo rápido que debe quedar hecho antes de responder. La contracara: si tarda, la respuesta tarda; y si lanza una excepción, la petición falla.',
      code:
`// app/Listeners/ActualizarTotales.php
class ActualizarTotales
{
    public function handle(MultaRegistrada $event): void
    {
        Totales::where('fecha', today())->increment('multas');
    }
}`,
      facts: [['Se ejecuta', 'en la misma petición'], ['Si tarda', 'la respuesta tarda'], ['Si falla', 'la petición falla']],
      events: [
        { t: 0.023, from: 'dispatcher', to: 'sync',       type: 'internal', label: 'handle()',   info: 'ActualizarTotales::handle(MultaRegistrada $event)',
          ask: 'ActualizarTotales no implementa ShouldQueue. ¿A quién llama el Dispatcher de inmediato?' },
        { t: 0.024, from: 'sync',       to: 'db',         type: 'sql',      label: 'totales +1', info: 'update `totales` set `multas` = `multas` + 1 where `fecha` = ?' },
        { t: 0.027, from: 'db',         to: 'sync',       type: 'response', label: '1 fila',     info: '1 fila actualizada · 2.6 ms' },
        { t: 0.028, from: 'sync',       to: 'dispatcher', type: 'response', label: 'listo',      info: 'handle() terminó · el Dispatcher sigue con el siguiente listener' }
      ]
    },
    {
      title: 'Listener en cola y difusión',
      subtitle: 'Lo lento no se hace aquí',
      description:
        'Enviar un correo o avisar a otros navegadores es lento, así que no se hace dentro de la petición. Un listener que implementa ShouldQueue no se ejecuta: el Dispatcher lo envuelve en un job y lo deja en la cola. Lo mismo pasa con el propio evento, que implementa ShouldBroadcast. El usuario recibe su respuesta en unos 36 ms.',
      code:
`// app/Listeners/NotificarInfractor.php
class NotificarInfractor implements ShouldQueue
{
    public $tries = 3;

    public function handle(MultaRegistrada $event): void
    {
        Mail::to($event->multa->infractor->email)
            ->send(new MultaRegistradaMail($event->multa));
    }
}

// Si el evento se dispara dentro de una transacción,
// se espera al commit antes de avisar a los listeners:
class MultaRegistrada implements ShouldBroadcast, ShouldDispatchAfterCommit`,
      facts: [['Listener en cola', 'implements ShouldQueue'], ['Evento difundido', 'implements ShouldBroadcast'], ['Dentro de una transacción', 'ShouldDispatchAfterCommit'], ['Respuesta al usuario', '≈ 36 ms']],
      events: [
        { t: 0.029, from: 'dispatcher', to: 'redis',      type: 'queue',    label: 'CallQueuedListener', info: 'RPUSH queues:default {"displayName":"App\\\\Listeners\\\\NotificarInfractor", …}', size: '1.1 KB',
          ask: 'NotificarInfractor implementa ShouldQueue. En vez de ejecutarlo, ¿a dónde lo envía el Dispatcher?' },
        { t: 0.030, from: 'dispatcher', to: 'redis',      type: 'queue',    label: 'BroadcastEvent',     info: 'El evento es ShouldBroadcast: RPUSH queues:default {"displayName":"App\\\\Events\\\\MultaRegistrada", …}', size: '940 B' },
        { t: 0.031, from: 'dispatcher', to: 'controller', type: 'response', label: 'return',             info: 'dispatch() vuelve: los listeners síncronos ya corrieron' },
        { t: 0.036, from: 'controller', to: 'browser',    type: 'response', label: '302 Found',          info: '302 → /multas/124 · el correo y el aviso en vivo aún no han salido',
          ask: 'Los dos trabajos lentos quedaron en la cola. ¿A quién le responde ya el controlador?' }
      ]
    },
    {
      title: 'El worker notifica',
      subtitle: 'El listener corre en otro proceso',
      description:
        'En otro proceso, el worker saca el trabajo de la cola y ejecuta handle() del listener. Tiene las mismas ventajas que cualquier job: reintentos, espera entre intentos y registro en failed_jobs si se agotan. El infractor recibe el correo casi un segundo después, sin que el agente haya esperado.',
      code:
`// El listener puede decidir si vale la pena encolarse
public function shouldQueue(MultaRegistrada $event): bool
{
    return $event->multa->infractor->email !== null;
}

// Y qué hacer si se agotan los intentos
public function failed(MultaRegistrada $event, Throwable $e): void
{
    Log::error('No se notificó la multa', ['id' => $event->multa->id]);
}`,
      facts: [['Proceso', 'queue:work'], ['Reintentos', '$tries, $backoff'], ['Si falla del todo', 'failed_jobs + failed()']],
      events: [
        { t: 0.210, from: 'redis',  to: 'worker', type: 'queue',    label: 'pop',      info: 'El worker toma CallQueuedListener (NotificarInfractor)' },
        { t: 0.212, from: 'worker', to: 'queued', type: 'internal', label: 'handle()', info: 'NotificarInfractor::handle(MultaRegistrada $event)',
          ask: 'El worker sacó de la cola el trabajo CallQueuedListener. ¿A quién le ejecuta handle()?' },
        { t: 0.220, from: 'queued', to: 'smtp',   type: 'request',  label: 'SMTP',     info: 'Mail::to($infractor)->send(new MultaRegistradaMail($multa))', size: '24 KB' },
        { t: 0.840, from: 'smtp',   to: 'queued', type: 'response', label: '250 OK',   info: '250 2.0.0 OK queued as 4B7D91' }
      ]
    },
    {
      title: 'Aviso en tiempo real',
      subtitle: 'El evento llega a otros navegadores',
      description:
        'El mismo evento llega a otros navegadores. El worker lo publica en Reverb, el servidor de WebSockets de Laravel, y Reverb lo empuja a quienes estén suscritos al canal. En el panel, Laravel Echo recibe el evento y agrega la fila sin recargar la página. El canal es privado: solo entran los usuarios autorizados en routes/channels.php.',
      code:
`// resources/js/panel.js
Echo.private('multas')
    .listen('MultaRegistrada', (e) => {
        agregarFila(e.multa);
    });

// routes/channels.php (PHP): quién puede escuchar el canal
Broadcast::channel('multas', fn (User $user) => $user->esAgente());`,
      facts: [['Servidor', 'Laravel Reverb'], ['Cliente', 'Laravel Echo'], ['Canal', 'private-multas'], ['Autorización', 'routes/channels.php']],
      events: [
        { t: 0.845, from: 'redis',  to: 'worker',    type: 'queue',   label: 'pop',         info: 'El worker toma BroadcastEvent (MultaRegistrada)' },
        { t: 0.848, from: 'worker', to: 'reverb',    type: 'request', label: 'POST evento', info: 'POST /apps/{app_id}/events · canal private-multas · evento MultaRegistrada', size: '620 B',
          ask: 'El worker sacó el trabajo BroadcastEvent. ¿A qué servidor le publica el evento?' },
        { t: 0.852, from: 'reverb', to: 'dashboard', type: 'request', label: 'WS: multa',   info: 'WebSocket → suscriptores de private-multas: {"multa":{"id":124,"placa":"ABC123"}}', size: '310 B',
          ask: 'Reverb recibió el evento para el canal private-multas. ¿Quién lo recibe por WebSocket?' }
      ]
    }
  ],
  quiz: [
    {
      q: 'Un listener síncrono tarda 3 segundos. ¿Qué nota el usuario que envió el formulario?',
      options: [
        'Su respuesta tarda 3 segundos más, porque el listener corre dentro de la misma petición',
        'Nada: todos los listeners corren en segundo plano',
        'Recibe un error 504 automáticamente',
        'El listener se cancela pasado un segundo'
      ],
      answer: 0,
      explain: 'Un listener normal se ejecuta en la misma petición, antes de que el controlador responda. Por eso solo conviene para trabajo rápido.',
      nodes: ['dispatcher', 'sync']
    },
    {
      q: '¿Qué hace que un listener se ejecute en la cola y no dentro de la petición?',
      options: [
        'Que implemente la interfaz ShouldQueue',
        'Que su nombre termine en «Job»',
        'Que el evento se dispare con event() en lugar de dispatch()',
        'Que esté registrado en config/queue.php'
      ],
      answer: 0,
      explain: 'Con ShouldQueue, el Dispatcher no ejecuta el listener: lo envuelve en un job (CallQueuedListener) y lo deja en la cola para un worker.',
      nodes: ['queued', 'redis']
    },
    {
      q: 'En Laravel 11 y 12, ¿cómo sabe el framework qué listeners corresponden a un evento sin registrarlos a mano?',
      options: [
        'Recorre app/Listeners y lee el tipo del parámetro de handle()',
        'Compara el nombre del listener con el del evento',
        'Hay que listarlos en config/app.php',
        'Solo funciona si evento y listener están en el mismo archivo'
      ],
      answer: 0,
      explain: 'El descubrimiento automático revisa app/Listeners y asocia cada método handle() con el evento que declara como parámetro. Se puede ver con php artisan event:list.',
      nodes: ['dispatcher']
    },
    {
      q: 'Disparas el evento dentro de una transacción y el listener en cola no encuentra la multa en la base de datos. ¿Por qué?',
      options: [
        'El worker lo procesó antes del commit; hay que despachar después del commit',
        'Los listeners en cola no pueden leer la base de datos',
        'Redis borró el job por ser demasiado grande',
        'Faltó llamar a save() dentro del listener'
      ],
      answer: 0,
      explain: 'El worker es otro proceso y puede ir más rápido que tu commit. ShouldDispatchAfterCommit en el evento (o ShouldQueueAfterCommit en el listener) hace que se espere a que la transacción termine.',
      nodes: ['db', 'worker']
    },
    {
      q: '¿Qué necesita el evento para llegar al navegador de otros usuarios en tiempo real?',
      options: [
        'Implementar ShouldBroadcast y tener un servidor de WebSockets como Reverb',
        'Que los otros usuarios recarguen la página cada pocos segundos',
        'Un listener síncrono que les envíe un correo',
        'Guardar el evento en la sesión de cada usuario'
      ],
      answer: 0,
      explain: 'ShouldBroadcast hace que el evento se publique en el servidor de WebSockets. Reverb lo empuja a quienes estén suscritos al canal y Laravel Echo lo recibe en el navegador.',
      nodes: ['reverb', 'dashboard']
    }
  ]
});
