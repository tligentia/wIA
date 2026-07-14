# 🚀 Manual de Instalación y Despliegue de AnonimAE (v1.2.1)

Este manual detalla los requerimientos, pasos de instalación, configuración del motor de reglas, empaquetado de la extensión de navegador y resolución de problemas comunes para la implementación del ecosistema corporativo **AnonimAE**.

---

## 🏗️ Requerimientos del Sistema

* **Entorno del Servidor / Host**:
  * Node.js v18.0.0 o superior (recomendado v20.x o v22.x LTS).
  * NPM v9.0.0 o superior.
* **Cliente / Navegadores Compatibles**:
  * Google Chrome v100 o superior (Soporte para Extensiones Manifest V3).
  * Microsoft Edge, Brave, Opera u otros navegadores basados en Chromium.

---

## 📦 Paso 1: Instalación y Configuración del Servidor local

El backend de AnonimAE está desarrollado en Node.js sobre un servidor Express optimizado para procesar múltiples formatos de archivos en memoria con total privacidad.

1. **Extraer o Clonar el Repositorio**:
   Ubica los archivos del proyecto en la ruta de tu servidor o disco de trabajo local.
   
2. **Instalar Dependencias de Producción**:
   Abre una terminal en el directorio raíz del proyecto y ejecuta:
   ```bash
   npm install
   ```
   Esto instalará de forma automática las siguientes dependencias clave:
   * `express`: Servidor web ligero para las APIs.
   * `yaml`: Procesador de configuraciones de reglas en caliente.
   * `adm-zip`: Gestor en memoria para la compresión/descompresión de archivos DOCX y XLSX.
   * `xlsx`: Parser de hojas de cálculo de Microsoft Excel.
   * `pdf-parse`: Extractor y anonimizador de documentos en formato PDF.

3. **Iniciar el Servidor**:
   * **Modo Desarrollo (con auto-recarga)**:
     ```bash
     npm run dev
     ```
   * **Modo Producción**:
     ```bash
     npm start
     ```
   Por defecto, el servidor se iniciará en el puerto **3000** (`http://localhost:3000`).

---

## 🛠️ Paso 2: Personalización del Motor de Reglas (`rules.yaml`)

Toda la lógica del motor DLP se gobierna a través del archivo de configuración central ubicado en `config/rules.yaml`.

* **Estructura del archivo**:
  * `entities`: Define las reglas basadas en expresiones regulares. Puedes añadir nuevas entidades definiendo un `id`, `name`, `placeholder`, `type: "regex"` y la lista de `patterns` regex.
  * `dictionaries`: Contiene listas estáticas de palabras clave para búsquedas exhaustivas (ej. `nombres` y `organizaciones`).
* **Actualización en Caliente**: El servidor lee el archivo `rules.yaml` en cada inicio o cambio. Si añades un nuevo patrón para capturar, por ejemplo, números de la seguridad social, el servidor lo procesará de inmediato sin necesidad de reescribir código JS en el backend.

---

## 🔌 Paso 3: Empaquetado e Instalación de la Extensión AnonimAE DLP Shield

La extensión se distribuye como un paquete pre-compilado listo para cargarse en modo desarrollador en cualquier navegador compatible con Chromium.

1. **Sincronizar la extensión descomprimida**:
   En el directorio raíz del proyecto, ejecuta el script de empaquetado:
   ```bash
   npm run package-extension
   ```
   Este script incrementa y sincroniza la versión, compila `config/rules.yaml` como `default_rules.json`, actualiza el frontend local y deja lista la carpeta **`extension/`** en la raíz del proyecto. También limpia archivos antiguos de salidas previas antes de copiar los recursos actuales.

2. **Cargar en el Navegador (Chrome / Edge / Brave)**:
   * Abre tu navegador y navega a `chrome://extensions/`.
   * En la esquina superior derecha, activa el **"Modo de desarrollador"** (Developer mode).
   * Haz clic en el botón **"Cargar descomprimida"** (Load unpacked) en la esquina superior izquierda.
   * Selecciona la carpeta **`extension/`** generada en la raíz del proyecto.
   * El icono del escudo de AnonimAE aparecerá inmediatamente en tu barra de extensiones.

3. **Conexión Inicial**:
   * Haz clic en el icono del escudo de la extensión en la barra de herramientas.
   * Introduce una **Contraseña Maestra** para inicializar la clave AES-256-GCM.
   * Verifica que el indicador de conexión local muestre el estado **"Servidor Conectado"** (luz verde parpadeante).

---

## 🔒 Resolución de Problemas y Aspectos Técnicos Avanzados

### 1. Resolución de Errores de Origen Cruzado (CORS)
La extensión realiza peticiones locales desde páginas seguras HTTPS (como `https://chatgpt.com`) hacia el backend HTTP en `http://localhost:3000`.
* **Solución nativa**: El archivo `src/backend/server.js` ya incorpora un middleware personalizado de CORS que configura de forma robusta las cabeceras `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers` y `Access-Control-Allow-Methods`. Además, responde de inmediato con un código `200 OK` a todas las solicitudes de verificación previa (`OPTIONS`), asegurando que ningún navegador bloquee la comunicación en local.

### 2. Detección del Usuario y Credenciales en Auditoría (`audit.json`)
El motor registra de forma proactiva quién realiza cada anonimización para mantener la trazabilidad DLP empresarial:
* **En el navegador**: La extensión scrapea el perfil activo en la interfaz de la IA actual (como el nombre de cuenta de Claude o Gemini) y lo asocia a la transacción en el servidor.
* **En local (OS Fallback)**: Si se utiliza el playground web o la extensión no logra identificar una cuenta en el chat, el servidor utiliza una consulta nativa de Node.js (`os.userInfo().username`) para extraer el nombre del usuario autenticado en la sesión de macOS/Linux/Windows, asegurando que todas las transacciones queden firmadas de forma auditable en `audit.json`.

### 3. Modificar Puertos por Defecto
Si el puerto `3000` está ocupado por otro servicio en tu infraestructura:
1. Abre `src/backend/server.js` y cambia la variable `PORT` al número deseado (ej. `3080`).
2. Abre `src/extension/manifest.json` y actualiza la regla `"host_permissions"` con el nuevo puerto: `"http://localhost:3080/*"`.
3. Abre `src/extension/content.js` y `src/extension/popup.js` y cambia las llamadas `fetch` para apuntar a la URL corregida (`http://localhost:3080`).
4. Re-empaqueta la extensión con `npm run package-extension` y recárgala en tu navegador.
