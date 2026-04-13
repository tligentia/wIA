# wIA — Local AI Chat Interface

**wIA** es una interfaz de chat para Inteligencia Artificial moderna, privada y de alto rendimiento, diseñada para ejecutarse completamente en tu máquina local. Utiliza **Ollama** o **LM Studio** como motores de inferencia, garantizando que tus datos y conversaciones nunca salgan de tu entorno.

![wIA Logo](favicon.png)

## 🚀 Características Principales

- **Privacidad Total**: Ejecución 100% local. Sin rastreo, sin telemetría en la nube.
- **Multi-Modelo**: Soporte nativo para Ollama y cualquier API compatible con OpenAI (como LM Studio).
- **Gestión de Proyectos**: Organiza tus conversaciones en Workspaces temáticos con instrucciones personalizadas y bases de conocimiento específicas.
- **Base de Conocimiento (RAG Local)**: Sube documentos (PDF, TXT, MD, JS, etc.) a un proyecto para que la IA los use como referencia constante en todos los chats de ese espacio.
- **Modo Pensamiento (Thinking)**: Visualiza el proceso de razonamiento de los modelos que soportan "Chain of Thought" (como DeepSeek R1 o Gemma 4).
- **Herramientas Inteligentes**: Búsqueda integrada en Wikipedia para contrastar datos factuales en tiempo real.
- **Diseño Premium**: Interfaz fluida basada en el sistema de diseño *Antigravity*, con modos Oscuro, Claro y Vanilla, optimizada para una experiencia de usuario superior.

## 🛠️ Requisitos

1. **Motor de Inferencia**:
   - [Ollama](https://ollama.ai/) (Recomendado) ejecutándose en `http://localhost:11434`.
   - [LM Studio](https://lmstudio.ai/) ejecutándose en modo Local Server.
2. **Navegador Moderno**: Chrome, Edge, Safari o Firefox.

## 📦 Instalación y Uso

1. Clona o descarga este repositorio en una carpeta local.
2. Abre el archivo `index.html` en tu navegador.
3. Configura tu modelo preferido desde el panel de **Configuración** (⚙️).
   - *Nota: Asegúrate de haber descargado previamente el modelo en Ollama (`ollama pull gemma2`, por ejemplo).*

## 📂 Estructura del Proyecto

- `index.html`: Estructura principal y componentes de la UI.
- `app.js`: Lógica de la aplicación, gestión de estados y conectividad con APIs.
- `styles.css`: Sistema de diseño *Antigravity* con variables CSS dinámicas.
- `lib/`: Librerías locales para soporte de PDF y otras utilidades.
- `favicon.png`: Logotipo oficial de la aplicación.

## 🤝 Contribuciones

Este es un proyecto enfocado en la simplicidad y la potencia local. Si deseas sugerir mejoras o reportar errores, siéntete libre de abrir un issue o enviar un pull request.

---
*Desarrollado con ❤️ para la comunidad de IA Local.*
