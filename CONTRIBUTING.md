# Cómo contribuir

Gracias por querer mejorar Explorer for Laravel. Este proyecto explica cómo funciona Laravel por dentro, así que lo más valioso que puedes aportar es **conocimiento correcto y bien explicado**.

## Qué puedes aportar

| Aporte | Cómo empezar |
|---|---|
| **Proponer un proceso nuevo** (migraciones, validación, caché, Livewire…) | Abre un issue con la plantilla [Proponer un proceso](https://github.com/LuizJack/explorer-for-laravel/issues/new/choose). |
| **Corregir un error** de contenido o de la página | Abre un issue con la plantilla *Reportar un error*, o envía directamente un pull request si el cambio es pequeño. |
| **Mejorar un proceso existente** (más claro, más preciso, mejores preguntas) | Pull request sobre su archivo en `js/scenarios/`. |
| **Mejorar el motor o el diseño** | Abre antes un issue para acordar el cambio. |

Para un proceso nuevo, abre primero el issue. Así acordamos el alcance antes de que inviertas tiempo en escribirlo.

## Preparar el proyecto

No hay dependencias ni proceso de build.

```bash
git clone https://github.com/TU-USUARIO/explorer-for-laravel.git
cd explorer-for-laravel
python -m http.server 8000      # o abre index.html directamente
```

## Escribir un proceso

Cada proceso es un archivo en `js/scenarios/`. La estructura completa, con un ejemplo, está en el [README](README.md#agregar-un-proceso-nuevo). Toma como modelo alguno de los que ya existen.

Reglas de contenido:

- **Versión.** Sigue las convenciones de Laravel 11 y 12. Si algo cambia entre versiones, dilo en la explicación.
- **Exactitud.** Cada afirmación debe poder comprobarse en la [documentación oficial](https://laravel.com/docs) o en el código del framework. En el pull request, enlaza la fuente de lo que no sea obvio.
- **Un hilo conductor.** Cuenta una historia concreta con datos de ejemplo (una multa, un usuario), no una lista de conceptos.
- **Pasos.** Entre 5 y 8. Cada uno con título, subtítulo, una explicación de 2 a 5 frases, el código relevante y de 2 a 4 datos clave.
- **Mensajes.** Cada mensaje va de un componente a otro, con un tipo y un detalle realista (la consulta SQL, la cabecera, el comando). Los tiempos (`t`) nunca retroceden.
- **Retos (`ask`).** De 6 a 9 por proceso. La pregunta debe dar el contexto necesario para deducir el destino, no para adivinarlo.
- **Preguntas (`quiz`).** Unas 5 por proceso, con 4 opciones. Las opciones incorrectas deben ser creíbles y la explicación debe enseñar algo, no solo repetir la respuesta.
- **Datos ficticios.** No uses nombres, correos, dominios ni credenciales reales.
- **Idioma.** Español neutro. Los nombres de clases, métodos y comandos van como en Laravel.

## Antes de enviar

1. Ejecuta el validador. Revisa que los nodos existan, que los tiempos estén en orden y que las preguntas estén completas:

   ```bash
   node scripts/validate.js
   ```

2. Abre la página y recorre tu proceso en las vistas **Red** y **Secuencia**, en tema claro y oscuro. Comprueba que ninguna línea tape un nombre.
3. Haz los dos tests de tu proceso de principio a fin.

## Enviar el pull request

1. Haz un fork y crea una rama a partir de `main` (por ejemplo `proceso-migraciones`).
2. Un pull request por tema: un proceso nuevo, o una corrección.
3. Explica qué cambia y enlaza el issue relacionado.

El mantenedor revisa cada pull request y es el único que fusiona cambios en `main`. Puede pedirte ajustes o editar el texto para mantener un estilo uniforme. Ten paciencia: es un proyecto mantenido en tiempo libre.

## Licencia de los aportes

El proyecto se publica bajo la licencia [MIT](LICENSE). Al enviar un pull request aceptas que tu aporte se publique bajo esa misma licencia.

## Convivencia

Trata a los demás con respeto. Las críticas van dirigidas al contenido, no a las personas. Los comentarios ofensivos se eliminan.

## Seguridad

Si encuentras una vulnerabilidad, no abras un issue público. Sigue lo indicado en [SECURITY.md](SECURITY.md).
