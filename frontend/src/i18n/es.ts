import type { TranslationKey } from "./en";

const es: Record<TranslationKey, string> = {
  // Header Controls
  "header.settings": "AJUSTES",

  // Modals
  "modal.close": "Cerrar",

  // Settings
  "settings.title": "Configuraciones",
  "settings.sessionBehavior": "Comportamiento de sesiones",
  "settings.autoFollow": "Seguir nuevas sesiones automáticamente",
  "settings.autoFollowDesc":
    "Cambiar automáticamente a nuevas sesiones en el proyecto actual",
  "settings.floorTogether": "Ver las otras sesiones del piso",
  "settings.floorTogetherDesc":
    "El Claude de otras sesiones que trabajan en el mismo piso entra en la oficina. Desactivado, solo se ve la sesión elegida.",
  "settings.language": "Idioma",
  "settings.theme": "Tema",
  "settings.theme.light": "Claro",
  "settings.theme.dark": "Oscuro",
  "settings.tabs.general": "General",
  "settings.tabs.connect": "Conectar",
  "settings.connect.intro":
    "Cada botón ejecuta por ti el comando de conexión en este equipo. El resto de tu configuración no cambia; solo se añade el hook de Agent Office.",
  "settings.connect.connected": "Conectado",
  "settings.connect.notConnected": "Sin conectar",
  "settings.connect.connect": "Conectar",
  "settings.connect.reconnect": "Reconectar",
  "settings.connect.disconnect": "Desconectar",
  "settings.connect.running": "Ejecutando…",
  "settings.connect.done": "Listo.",
  "settings.connect.failed": "No funcionó. Revisa la salida de abajo.",
  "settings.connect.output": "Salida · {command}",
  "settings.connect.cliMissing":
    "Todavía no se encuentra el comando {cli} en este equipo.",
  "settings.connect.toolMissing":
    "Falta la herramienta del hook. Vuelve a conectar para instalarla.",
  "settings.connect.afterClaude":
    "Las sesiones de Claude Code que abras a partir de ahora aparecerán en la oficina.",
  "settings.connect.afterCodex":
    "En Codex, abre /hooks y confía en el hook de Agent Office; si no, no se ejecuta.",
  "settings.connect.afterGemini":
    "Las sesiones de Gemini CLI que abras a partir de ahora aparecerán en la oficina.",
  "settings.connect.needToken":
    "Para conectar, abre esta página desde la línea 「Agent Office: http://localhost:4747/?token=…」 de la terminal del backend.",
  "settings.connect.notLocal":
    "Este backend es accesible desde otros equipos (por ejemplo, Docker), así que no puede conectar agentes. Ejecuta make hooks-install en una terminal.",
  "settings.connect.cannotRun":
    "Este backend no puede ejecutar el comando de conexión ({reason}). Ejecuta make hooks-install desde el repositorio en una terminal.",
  "settings.connect.busy": "Otra conexión sigue en curso.",
  "settings.connect.loadFailed":
    "No se pudo leer el estado de las conexiones. ¿Está en marcha el backend?",

  // Agent Status
  "agentStatus.inQueue": "En cola de {queueType} (posición {position})",

  // Office rooms
  "office.unknownAgent": "Agente",

  // Isometric office
  "iso.live": "LIVE",
  "iso.offline": "SIN CONEXIÓN",
  "iso.controlsHint":
    "Arrastra para mover · Rueda para ampliar · Doble clic para restablecer",
  "iso.me": "Yo",
  "iso.agentType.general": "General",
  "iso.bubble.thinking": "Pensando",
  "iso.bubble.thinkingFor": "Pensando desde hace {seconds}s",
  "iso.bubble.looking": "Revisando",
  "iso.bubble.bye": "👋 ¡Me voy a casa!",
  "iso.bubble.compacting": "☕ Compactando la conversación",
  "iso.panel.project": "Proyecto",
  "iso.panel.session": "Sesión",
  "iso.panel.people": "Oficina",
  "iso.panel.atWork": "{count} trabajando",
  "iso.panel.working": "Trabajando",
  "iso.panel.tools": "{count} herramientas · {seconds}s",
  "iso.panel.tools_one": "{count} herramienta · {seconds}s",
  "iso.panel.colleague": "Otra sesión de este piso · {seconds}s",
  "iso.panel.tools_other": "{count} herramientas · {seconds}s",
  "iso.panel.log": "Registro de actividad",
  "iso.panel.logTime": "{h}:{m}:{s}",
  "iso.panel.rooms": "Plano de la oficina",
  "iso.room.library": "Biblioteca",
  "iso.room.dev": "Sala de desarrollo",
  "iso.room.server": "Sala de servidores",
  "iso.room.search": "Sala de búsqueda",
  "iso.room.meeting": "Sala de reuniones",
  "iso.room.mydesk": "Mi escritorio",
  "iso.room.lounge": "Sala de descanso",
  "iso.room.cafe": "Cafetería",
  "iso.room.elevator": "Ascensor",
  "iso.roomDoes.library": "Leer · buscar archivos",
  "iso.roomDoes.dev": "Escribir · editar código",
  "iso.roomDoes.server": "Ejecutar comandos · git",
  "iso.roomDoes.search": "Web · herramientas externas",
  "iso.roomDoes.meeting": "Planes · tareas · skills",
  "iso.roomDoes.mydesk": "Preguntas · llamadas para mí",
  "iso.roomDoes.lounge": "Descansar · esperar la siguiente pregunta",
  "iso.roomDoes.cafe": "Café antes de irse · al compactar",
  "iso.roomDoes.elevator": "Los subagentes llegan y se van",
  "iso.floor.title": "Guía de pisos",
  "iso.connect.empty": "Todavía no ha llegado nadie.",
  "iso.connect.cta": "Conectar un agente",
  "iso.floor.caption": "DIRECTORIO",
  "iso.floor.sessions": "{count} sesiones",
  "iso.floor.sessions_one": "{count} sesión",
  "iso.floor.sessions_other": "{count} sesiones",
  "iso.floor.activeNow": "Activo ahora",
  "iso.floor.follow": "Seguir la sesión más reciente",
  "iso.floor.together": "Ver las otras sesiones del piso",
  "iso.floor.untitled": "Sesión sin título · {id}",
  "iso.floor.moreIdle": "{count} pisos tranquilos más",
  "iso.floor.moreIdle_one": "{count} piso tranquilo más",
  "iso.floor.moreIdle_other": "{count} pisos tranquilos más",
  "iso.floor.lessIdle": "Contraer",

  // Zoom Controls
  "zoom.in": "Acercar",
  "zoom.out": "Alejar",
  "zoom.reset": "Restablecer zoom",

  // Status Messages
  "status.switchedToSession": "Cambió a sesión {sessionId}...",
  "status.deletingSession": "Eliminando sesión {sessionId}...",
  "status.sessionDeleted": "Sesión eliminada.",
  "status.failedDeleteSession": "Error al eliminar sesión.",
  "status.errorConnecting": "Error al conectar con el backend.",
  "status.sessionRenamed": "Sesión renombrada.",
  "status.failedRenameSession": "Error al renombrar la sesión.",
  "status.clearingDatabase": "Limpiando base de datos...",
  "status.databaseCleared": "Base de datos limpia.",
  "status.failedClearDatabase": "Error al limpiar base de datos.",
  "status.triggeringSimulation": "Iniciando simulación...",
  "status.simulationStarted": "¡Simulación iniciada!",
  "status.failedSimulation": "Error al iniciar simulación.",
  "status.storeReset": "Estado reiniciado.",
  "status.sessionDeletedSwitched": "Sesión eliminada. Cambió a {sessionName}",
  "status.sessionDeletedNoOthers":
    "Sesión eliminada. No hay otras sesiones disponibles.",
  "status.connectedTo": "Conectado a {sessionName}",
  "status.autoFollowed": "Siguiendo nueva sesión: {sessionName}",
};

export default es;
