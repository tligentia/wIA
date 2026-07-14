# 🛡️ Manual de Usuario de AnonimAE (v1.2.1)

Bienvenido a **AnonimAE**, la plataforma empresarial líder para la anonimización reversible local, privada y 100% segura. AnonimAE actúa como un escudo de Prevención de Pérdida de Datos (DLP) entre tu equipo y las Inteligencias Artificiales comerciales (ChatGPT, Claude, DeepSeek, Gemini, etc.), garantizando que ningún dato sensible o de carácter personal salga de tu infraestructura local sin protección.

---

## 💡 Filosofía Offline-First y Seguridad

AnonimAE se ejecuta por completo de forma **local** en tu máquina o servidor corporativo.
* **Sin Conexión Externa**: El motor de reglas de expresiones regulares, el diccionario y los modelos de Inteligencia Artificial locales (WebGPU Transformers) se descargan e inicializan en tu navegador y backend de forma aislada.
* **Seguridad Criptográfica AES-256-GCM**: Al anonimizar, las equivalencias originales se almacenan cifradas bajo una contraseña maestra mediante derivación de claves robusta (`scrypt`). Solo quien posee la contraseña maestra puede revertir el proceso.
* **Auditoría Local**: Todas las transacciones se registran de forma transparente en un archivo local (`audit.json`), visible exclusivamente para el administrador y el usuario desde el panel informativo de la aplicación.

---

## 🖥️ La Plataforma Web Playground

El panel web local (por defecto en `http://localhost:3000`) se divide en tres secciones tácticas y visuales inspiradas en la estética limpia de alta fidelidad:

### 1. Panel Lateral de Entidades de Control
Permite activar y desactivar en tiempo real los filtros para cada tipo de dato sensible antes de procesar el contenido:

| Icono | Entidad | ID de Regla | Descripción |
| :--- | :--- | :--- | :--- |
| 📧 | **Correo Electrónico** | `email` | Correos corporativos y personales. |
| 📞 | **Teléfono / Móvil** | `telefono` | Números de teléfono fijos, móviles y formatos internacionales. |
| 📠 | **Número de Fax** | `fax` | Filtro especializado para faxes nacionales e internacionales. |
| 🪪 | **DNI / NIE / NIF** | `dni` | Documentos de identidad y códigos CIF de empresas españolas. |
| 🏦 | **Código IBAN** | `iban` | Cuentas bancarias formateadas con o sin espacios. |
| 💳 | **Tarjeta de Crédito** | `tarjeta` | Números de tarjetas Visa, Mastercard, American Express, etc. |
| ⚖️ | **Expediente Judicial** | `juridico` | Procedimientos judiciales, autos, etc. |
| 📝 | **Número de Diligencias** | `diligencias` | Diligencias previas, urgentes (ej. *D.P. 567/2026* o *DP 123/2025*). |
| 📮 | **Código Postal** | `codigo_postal` | Códigos postales del territorio español (01000 - 52999). |
| 🛂 | **Pasaporte** | `pasaporte` | Pasaportes alfanuméricos con lógica de validación interna. |
| 👤 | **Nombre Completo** | `nombre` | Lógica avanzada con iniciales complejas (ej. `B GERDA`) y caracteres unicode (`ï`, `ü`, `ñ`, `Á`). |
| 🏢 | **Organización** | `organizacion` | Empresas y entidades detectadas dinámicamente mediante sufijos (*S.A.*, *S.L.*, *Ltd.*). |
| 📍 | **Dirección Física** | `direccion` | Calles, avenidas, plazas, números y pisos del territorio español. |

---

### 2. Panel del Playground (Entrada/Salida)
* **Anonimizar**: Pega tu texto con datos confidenciales en el cuadro de la izquierda y haz clic en **Anonimizar Contenido**. El motor sustituirá cada dato detectado por un token único y consistente (ej. `[Nombre_001]`, `[Telefono_001]`).
* **Desanonimizar**: Cuando recibas la respuesta de la IA (que conserva los tokens de forma segura), pégala en el panel derecho y haz clic en **Desanonimizar Contenido** para restaurar los valores reales al instante de forma totalmente reversible.

---

### 3. Bitácora de Auditoría en Tiempo Real
Situada en la parte inferior, registra de manera transparente cada transacción local:
* Muestra la fecha, el tipo de motor utilizado y la cantidad de entidades reemplazadas.
* **Detalle de Auditoría Flotante (i)**: Al hacer clic en el icono `(i)` de cualquier transacción, se abre un popup flotante glassmorphic que revela la **URL de la IA**, las **credenciales/nombre del usuario** que inició la transacción, el `ANON_REF` y los hashes criptográficos SHA-256 correspondientes para el control de cumplimiento RGPD.

---

### 4. Administrador Dinámico de Modelos WebGPU
Para una detección semántica y de lenguaje natural más potente:
* Haz clic en **Gestionar Modelos** junto al selector de modelos de IA.
* Puedes añadir repositorios compatibles de Hugging Face (ej. `Xenova/bert-base-NER`) y descargarlos en segundo plano para que se almacenen de forma persistente en la caché de tu navegador.
* Un icono de estado en tiempo real te informará si el modelo está descargando (icono de carga dinámico `fa-spinner`) o si ya está disponible en la caché local para trabajar 100% offline (círculo verde `fa-circle-check`).

---

## 🔌 La Extensión de Navegador AnonimAE DLP Shield

La extensión de navegador (compatible con Google Chrome, Edge, Brave y Opera) lleva la protección DLP directamente a tus aplicaciones cotidianas de Inteligencia Artificial.

### 🛡️ Características Principales:
1. **Detección Universal de Chats**: Se integra visualmente de forma automática en los cuadros de texto de **ChatGPT, Claude, DeepSeek, Gemini, Copilot, Perplexity, Poe y Hugging Face Chat**.
2. **Botón Escudo Compacto**: Aparece un elegante botón de escudo de AnonimAE en la esquina inferior derecha de cada cuadro de entrada de prompt compatible. Al pulsarlo:
   * Los datos sensibles del prompt se analizan y anonimizan localmente en décimas de segundo.
   * El prompt original y seguro (con placeholders) se inserta automáticamente en la caja del chat empleando simulaciones nativas de React/Vue, asegurando que la IA reciba únicamente información inocua.
3. **Escudo Inline Toggle `[Referencia: UUID 🛡️ DLP]`**:
   * Cuando la Inteligencia Artificial responde, la extensión detecta el bloque de referencia criptográfica `ANON_REF` e inyecta un escudo compacto interactivo dentro de la burbuja del chat.
   * Al hacer clic en el escudo, la extensión **conmuta de forma reversible** entre el texto anonimizado original de la IA (conservando tablas, listas y código de programación) y el texto desanonimizado con los nombres, teléfonos y faxes reales restaurados en caliente en el propio DOM.
4. **Intercepción de Archivos Adjuntos (DLP)**:
   * Si intentas arrastrar un documento o cargarlo desde el selector de archivos nativo de la plataforma de IA, AnonimAE intercepta la acción.
   * Si es un archivo de texto (`.txt`, `.md`, `.json`, `.csv`), se lee y anonimiza localmente.
   * Si es un documento de oficina binario (`.docx`, `.xlsx`, `.pdf`), se envía al servidor local en un buffer seguro, se extrae el texto o se manipula la estructura del archivo y se devuelve un clon del archivo 100% libre de datos personales antes de que la página de la IA se entere de la subida original.
5. **Gestor de Sitios Protegidos**:
   * Abre la extensión desde la barra de herramientas de tu navegador.
   * En la pestaña **Sitios Protegidos**, podrás ver si la página web que estás visualizando está protegida, añadir nuevos dominios personalizados o retirar la protección con un solo clic.

---

## ⚠️ Consejos de Seguridad y Buenas Prácticas

> [!WARNING]
> * **No alteres el bloque ANON_REF**: Al final de cada prompt anonimizado, el motor añade una firma `# ANON_REF: <UUID>` seguida de una directiva obligatoria para la IA. Si borras este bloque o el modelo de IA falla al devolverlo, la extensión no podrá realizar el toggle dinámico de desanonimización de esa burbuja.
> * **Mantén tu Contraseña Maestra Segura**: Las claves de descifrado se derivan de la contraseña maestra configurada en el popup de la extensión. Si cambias de contraseña en mitad de una sesión, las respuestas anteriores procesadas con la clave previa no se podrán descifrar hasta que vuelvas a ingresar la contraseña correspondiente.
