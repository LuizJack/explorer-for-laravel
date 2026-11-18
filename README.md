# Laravel Explorer

Explorador visual e interactivo de los procesos internos de **Laravel**. Cada proceso se divide en pasos, se dibujan los componentes que participan y se anima cada mensaje que viaja entre ellos, con un registro de eventos al estilo de Wireshark.

Inspirado en [Protocol Explorer](https://protocol-explorer-alpha.vercel.app/) de Dilum Sanjaya, que hace lo mismo con los protocolos de red.

## Procesos incluidos

| Escenario | Qué muestra |
|---|---|
| **Petición HTTP** | Nginx → PHP-FPM → `index.php` → Service Providers → HTTP Kernel → Router → middleware de ruta → controlador → Eloquent/MySQL → Blade → respuesta → `terminate()` |
| **Colas (jobs)** | `dispatch()` → Redis → worker (`queue:work` + Supervisor) → `handle()` → fallo por timeout → reintento con *backoff* → confirmación / `failed_jobs` |
| **Inicio de sesión** | Formulario → CSRF → `LoginRequest` + RateLimiter → `Auth::attempt()` → User Provider → `Hash::check()` → sesión regenerada → redirección |

## Cómo ejecutarlo

No tiene dependencias ni proceso de build. Cualquiera de estas opciones sirve:

- Abrir `index.html` directamente en el navegador.
- En VS Code, con la extensión **Live Server**: clic derecho sobre `index.html` → *Open with Live Server*.
- Desde la terminal:

  ```bash
  python -m http.server 8000
  # o
  npx serve .
  ```

  y abrir <http://localhost:8000>.

**Atajos:** `Espacio` reproducir/pausar · `←` `→` evento anterior/siguiente · `Inicio` reiniciar.
También se puede enlazar un escenario directo: `index.html#queue`, `index.html#login`.

## Estructura

```
laravel-explorer/
├── index.html
├── css/
│   └── styles.css          # estilos, tema claro/oscuro automático
└── js/
    ├── app.js              # motor: diagrama SVG, animación, controles, tabla
    └── scenarios/
        ├── http.js         # ciclo de vida de una petición
        ├── queue.js        # colas y reintentos
        └── login.js        # autenticación
```

## Agregar un escenario nuevo

1. Crea `js/scenarios/mi-proceso.js`:

   ```js
   window.SCENARIOS = window.SCENARIOS || [];
   window.SCENARIOS.push({
     id: 'scheduler',                 // se usa en la URL: #scheduler
     name: 'Scheduler',               // texto de la pestaña
     tagline: 'Cómo corre schedule:run cada minuto',
     nodes: [
       // x: 80–920, y: 110 / 300 / 490 (columnas cada 140 px)
       // group: client | server | laravel | data | external
       { id: 'cron', label: 'cron', sub: '* * * * *', x: 80, y: 300, group: 'server' },
       { id: 'artisan', label: 'schedule:run', sub: 'artisan', x: 220, y: 300, group: 'laravel' }
     ],
     steps: [
       {
         title: 'Cron dispara',
         subtitle: 'Cada minuto',
         description: 'Explicación del paso…',
         code: `* * * * * cd /var/www/app && php artisan schedule:run`,
         facts: [['Frecuencia', 'cada minuto']],
         events: [
           // type: request | response | sql | cache | queue | internal | error
           { t: 0.000, from: 'cron', to: 'artisan', type: 'internal', label: 'schedule:run', info: 'Detalle para la tabla', size: '—' }
         ]
       }
     ]
   });
   ```

2. Agrégalo en `index.html` antes de `js/app.js`:

   ```html
   <script src="js/scenarios/mi-proceso.js"></script>
   ```

Las aristas del diagrama se crean solas a partir de los eventos, y si una línea atraviesa otro nodo se dibuja curva.

Ideas para próximos escenarios: Scheduler, eventos y listeners, broadcasting con Reverb, Livewire, Octane, migraciones, Sanctum (API tokens).

## Licencia

[MIT](LICENSE)
