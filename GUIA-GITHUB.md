# Subir esto a GitHub (para que lo vea el equipo)

El repo no necesita ninguna clave ni secreto: todas las fuentes son públicas (SEC EDGAR, Yahoo, FRED, CVM, BCB,
Damodaran, Secretaría de Energía). Lo único que hay que configurar son dos permisos.

## Antes de empezar: ¿público o privado?
- **Público** → GitHub Pages gratis (la web queda online y se actualiza sola todos los días).
- **Privado** → se puede compartir con los 3 integrantes como colaboradores, pero **Pages no funciona en cuentas gratuitas**:
  la actualización diaria igual corre y deja el `web/data.json` actualizado en el repo, y la página se abre con
  `ABRIR PAGINA - Barril Implicito.html`. Para ver la web online con repo privado hace falta plan pago.

Recomendación: público (no hay datos propios ni credenciales) y, si prefieren no exponerlo, privado + abrir la página desde el archivo.

## Opción A — Sin terminal (5 minutos)
1. github.com → **New repository** → nombre `brent-implicito` → elegir público/privado → **Create**.
2. En el repo: **Add file → Upload files** → arrastrar **el contenido** de la carpeta descomprimida (no la carpeta en sí).
   La carpeta oculta `.github/` a veces no se sube arrastrando: si no aparece, crearla con **Add file → Create new file**
   y pegar `.github/workflows/actualizar.yml` (el contenido está en el zip).
3. **Settings → Actions → General → Workflow permissions** → marcar **Read and write permissions** → Save.
   (La tarea diaria guarda los datos nuevos como commit; sin este permiso falla.)
4. Si el repo es público: **Settings → Pages → Source: GitHub Actions**.
5. **Actions → Actualizar datos → Run workflow** para correrlo la primera vez.
6. Invitar al equipo: **Settings → Collaborators → Add people**.

## Opción B — Con Claude Code (si preferís terminal)
Abrí una terminal en la carpeta descomprimida y ejecutá `claude`. Pegá este prompt:

```
Esta carpeta es un proyecto Python + web estática que ya funciona (leé el README.md).
Quiero publicarlo en GitHub para compartirlo con mi equipo.

1. Inicializá el repo git acá, con el .gitignore que ya está.
2. Creá el repositorio remoto con gh (nombre: brent-implicito, descripción: "Brent implícito en la
   capitalización bursátil de seis petroleras — TIF Finanzas UADE 2C2026"). Preguntame si lo querés
   público o privado antes de crearlo.
3. Primer commit con todo el contenido, incluida la carpeta .github/workflows.
4. Dejá el repo listo para que la GitHub Action corra sola:
   - activá "Read and write permissions" para Actions (gh api),
   - si es público, configurá Pages con source = GitHub Actions,
   - disparame una corrida manual del workflow y decime si pasó.
5. Antes de commitear, verificá que no haya credenciales ni tokens en ningún archivo.
6. Al final, dame la URL del repo, la de la página y el comando para invitar colaboradores.

No cambies la lógica del pipeline ni del motor: solo lo necesario para publicarlo.
```

**Qué hace falta tener antes:** `git`, la CLI `gh` (`gh auth login`, con permiso `workflow`) y Python 3.12.
**Qué adjuntar:** nada. Claude Code ya ve todos los archivos de la carpeta; alcanza con abrirlo ahí adentro.

## Después de publicarlo
- El equipo clona el repo y corre `pip install -r requirements.txt` y `python -m pipeline.run_all` si quiere datos frescos localmente.
- La tarea diaria (19:30 ART) baja datos, corre los tests, recalcula y publica. Cada corrida queda como commit:
  ese historial sirve como evidencia de proceso para el Anexo III.
- Para cargar un dato a mano: editar `inputs/operativos.csv` (un renglón por dato, siempre con link a la fuente) y hacer push;
  el push dispara el recálculo.
