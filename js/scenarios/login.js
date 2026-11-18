/*
 * Escenario: inicio de sesión con el guard "web" (estilo Breeze).
 */
window.SCENARIOS = window.SCENARIOS || [];
window.SCENARIOS.push({
  id: 'login',
  name: 'Inicio de sesión',
  tagline: 'Del formulario de login a la cookie de sesión autenticada',
  nodes: [
    { id: 'browser',    label: 'Navegador',         sub: 'POST /login',            x: 80,  y: 300, group: 'client' },
    { id: 'limiter',    label: 'RateLimiter',       sub: 'caché · 5 intentos',     x: 240, y: 110, group: 'data' },
    { id: 'middleware', label: 'Middleware',        sub: 'web · guest',            x: 240, y: 300, group: 'laravel' },
    { id: 'request',    label: 'LoginRequest',      sub: 'Form Request',           x: 400, y: 110, group: 'laravel' },
    { id: 'controller', label: 'AuthSession…',      sub: 'Controller@store',       x: 400, y: 300, group: 'laravel' },
    { id: 'session',    label: 'Sesión',            sub: 'Redis',                  x: 400, y: 490, group: 'data' },
    { id: 'guard',      label: 'SessionGuard',      sub: "guard 'web'",            x: 560, y: 300, group: 'laravel' },
    { id: 'events',     label: 'Eventos',           sub: 'Attempting · Login',     x: 560, y: 110, group: 'laravel' },
    { id: 'provider',   label: 'User Provider',     sub: 'EloquentUserProvider',   x: 720, y: 300, group: 'laravel' },
    { id: 'db',         label: 'MySQL',             sub: 'tabla users',            x: 720, y: 490, group: 'data' },
    { id: 'hash',       label: 'Hasher',            sub: 'bcrypt · cost 12',       x: 880, y: 300, group: 'laravel' }
  ],
  steps: [
    {
      title: 'Envío del formulario',
      subtitle: 'Correo, contraseña y token CSRF',
      description:
        'El usuario envía el formulario de login. Junto con el correo y la contraseña viaja el campo oculto _token que Blade insertó con @csrf, y la cookie de la sesión actual (todavía anónima).',
      code:
`<form method="POST" action="{{ route('login') }}">
    @csrf
    <input type="email" name="email" required autofocus>
    <input type="password" name="password" required>
    <label><input type="checkbox" name="remember"> Recordarme</label>
    <button type="submit">Ingresar</button>
</form>`,
      facts: [['Método', 'POST /login'], ['Campos', 'email, password, _token'], ['Transporte', 'HTTPS (la contraseña nunca en texto plano por la red)']],
      events: [
        { t: 0.000, from: 'browser', to: 'middleware', type: 'request', label: 'POST /login', info: 'POST /login · email=agente@transito.gov.co · password=•••••• · _token=Xk2…', size: '842 B' }
      ]
    },
    {
      title: 'Middleware',
      subtitle: 'CSRF y solo para invitados',
      description:
        'ValidateCsrfToken compara el _token del formulario con el guardado en la sesión; si no coinciden responde 419 (Page Expired). El middleware guest asegura que solo usuarios sin sesión iniciada lleguen al login.',
      code:
`// routes/auth.php
Route::middleware('guest')->group(function () {
    Route::post('login', [AuthenticatedSessionController::class, 'store']);
});

// Token que no coincide → 419 Page Expired`,
      facts: [['CSRF', 'ValidateCsrfToken'], ['Si falla', '419 Page Expired'], ['guest', 'si ya hay sesión → redirige al inicio']],
      events: [
        { t: 0.004, from: 'middleware', to: 'session',    type: 'cache',    label: 'GET _token',   info: 'StartSession + ValidateCsrfToken: lee el token guardado' },
        { t: 0.005, from: 'session',    to: 'middleware', type: 'response', label: 'token ✓',      info: 'hash_equals(sesión._token, request._token) = true' },
        { t: 0.006, from: 'middleware', to: 'controller', type: 'request',  label: 'guest ✓',      info: 'guest ✓ → AuthenticatedSessionController@store(LoginRequest $request)' }
      ]
    },
    {
      title: 'Validación y límite de intentos',
      subtitle: 'La Form Request revisa los datos',
      description:
        'Antes de llegar al controlador, Laravel resuelve LoginRequest: valida que email y password vengan bien y consulta el RateLimiter. Tras 5 intentos fallidos con el mismo correo e IP, bloquea temporalmente (protección contra fuerza bruta).',
      code:
`public function rules(): array
{
    return [
        'email' => ['required', 'string', 'email'],
        'password' => ['required', 'string'],
    ];
}

public function ensureIsNotRateLimited(): void
{
    if (! RateLimiter::tooManyAttempts($this->throttleKey(), 5)) {
        return;
    }
    throw ValidationException::withMessages([...]);
}`,
      facts: [['Clase', 'App\\Http\\Requests\\Auth\\LoginRequest'], ['Clave del limitador', 'email|ip'], ['Máximo', '5 intentos'], ['Si falla validación', '302 atrás con errores']],
      events: [
        { t: 0.007, from: 'controller', to: 'request',  type: 'internal', label: 'authenticate()',   info: '$request->authenticate() · reglas de validación ✓' },
        { t: 0.008, from: 'request',    to: 'limiter',  type: 'cache',    label: 'tooManyAttempts',  info: 'RateLimiter::tooManyAttempts("agente@transito.gov.co|190.24.8.15", 5)' },
        { t: 0.009, from: 'limiter',    to: 'request',  type: 'response', label: '0 / 5',            info: 'Intentos registrados: 0 → puede continuar' }
      ]
    },
    {
      title: 'Verificar credenciales',
      subtitle: 'Guard, provider y hash',
      description:
        'Auth::attempt() le pide al guard "web" que autentique. El guard dispara el evento Attempting y le pide al User Provider el usuario por correo. El provider busca en la tabla users y compara la contraseña con Hash::check(). bcrypt es lento a propósito (unas décimas de segundo) para encarecer la fuerza bruta.',
      code:
`if (! Auth::attempt($this->only('email', 'password'), $this->boolean('remember'))) {
    RateLimiter::hit($this->throttleKey());

    throw ValidationException::withMessages([
        'email' => trans('auth.failed'),
    ]);
}`,
      facts: [['Guard', 'SessionGuard (web)'], ['Provider', 'EloquentUserProvider'], ['Algoritmo', 'bcrypt, cost 12'], ['Contraseña incorrecta', 'RateLimiter::hit() + error']],
      events: [
        { t: 0.010, from: 'request',  to: 'guard',    type: 'request',  label: 'attempt()',        info: "Auth::attempt(['email' => …, 'password' => …], remember: false)" },
        { t: 0.010, from: 'guard',    to: 'events',   type: 'internal', label: 'Attempting',       info: 'event(new Attempting(guard: web, credentials, remember))' },
        { t: 0.011, from: 'guard',    to: 'provider', type: 'request',  label: 'retrieveBy…',      info: 'retrieveByCredentials(email)' },
        { t: 0.012, from: 'provider', to: 'db',       type: 'sql',      label: 'users',            info: 'select * from `users` where `email` = ? limit 1' },
        { t: 0.014, from: 'db',       to: 'provider', type: 'response', label: '1 fila',           info: '1 fila · Usuario #7 · password=$2y$12$Qm…' },
        { t: 0.015, from: 'provider', to: 'hash',     type: 'request',  label: 'Hash::check()',    info: 'password_verify(entrada, $2y$12$Qm…)' },
        { t: 0.215, from: 'hash',     to: 'provider', type: 'response', label: 'true ✓',           info: 'Contraseña correcta · ≈ 200 ms (bcrypt cost 12)' },
        { t: 0.216, from: 'provider', to: 'guard',    type: 'response', label: 'válido ✓',         info: 'validateCredentials() = true' }
      ]
    },
    {
      title: 'Crear la sesión autenticada',
      subtitle: 'Regenerar el id y guardar el usuario',
      description:
        'El guard guarda el id del usuario en la sesión y dispara el evento Login. Después el controlador regenera el id de sesión: así se evita la fijación de sesión (que un atacante reutilice un id que conocía antes del login). El RateLimiter se limpia porque el intento fue exitoso.',
      code:
`public function store(LoginRequest $request): RedirectResponse
{
    $request->authenticate();

    $request->session()->regenerate();   // evita session fixation

    return redirect()->intended(route('dashboard', absolute: false));
}`,
      facts: [['Clave en sesión', 'login_web_<hash> = 7'], ['Seguridad', 'session()->regenerate()'], ['Evento', 'Illuminate\\Auth\\Events\\Login']],
      events: [
        { t: 0.217, from: 'guard',      to: 'session', type: 'cache',    label: 'login_web_… = 7', info: 'updateSession(7): put("login_web_59ba…", 7) + migrate()' },
        { t: 0.217, from: 'guard',      to: 'events',  type: 'internal', label: 'Login',           info: 'event(new Login(guard: web, user: #7, remember: false))' },
        { t: 0.218, from: 'request',    to: 'limiter', type: 'cache',    label: 'clear()',         info: 'RateLimiter::clear(throttleKey)' },
        { t: 0.219, from: 'controller', to: 'session', type: 'cache',    label: 'regenerate()',    info: '$request->session()->regenerate() · nuevo id de sesión' }
      ]
    },
    {
      title: 'Redirección',
      subtitle: 'El navegador recibe la nueva cookie',
      description:
        'El controlador responde con un 302 hacia la página que el usuario quería visitar (intended) o al dashboard. La respuesta trae la cookie de sesión nueva, cifrada. En la siguiente petición, el middleware auth encontrará al usuario #7 en esa sesión.',
      code:
`HTTP/1.1 302 Found
Location: https://app.transito.gov.co/dashboard
Set-Cookie: laravel_session=eyJpdiI6…; path=/; secure; httponly; samesite=lax`,
      facts: [['Estado', '302 Found'], ['Destino', 'intended() o /dashboard'], ['Cookie', 'secure · httponly · samesite=lax'], ['Tiempo total', '≈ 225 ms']],
      events: [
        { t: 0.222, from: 'controller', to: 'browser', type: 'response', label: '302 → /dashboard', info: '302 Found · Location: /dashboard · Set-Cookie: laravel_session (nueva)', size: '1.2 KB' }
      ]
    }
  ]
});
