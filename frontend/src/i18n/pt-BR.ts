import type { TranslationKey } from "./en";

const ptBR: Record<TranslationKey, string> = {
  // Header Controls
  "header.settings": "CONFIGURAÇÕES",

  // Modals
  "modal.close": "Fechar",

  // Settings
  "settings.title": "Configurações",
  "settings.sessionBehavior": "Comportamento de Sessão",
  "settings.autoFollow": "Seguir novas sessões automaticamente",
  "settings.autoFollowDesc":
    "Alternar automaticamente para novas sessões no projeto atual",
  "settings.floorTogether": "Ver as outras sessões do andar",
  "settings.floorTogetherDesc":
    "O Claude de outras sessões trabalhando no mesmo andar entra no escritório. Desligado, só aparece a sessão escolhida.",
  "settings.language": "Idioma",
  "settings.theme": "Tema",
  "settings.theme.light": "Claro",
  "settings.theme.dark": "Escuro",
  "settings.tabs.general": "Geral",
  "settings.tabs.connect": "Conectar",
  "settings.connect.intro":
    "Cada botão executa para você o comando de conexão neste computador. O resto das suas configurações fica como está; só o hook do Agent Office é adicionado.",
  "settings.connect.connected": "Conectado",
  "settings.connect.notConnected": "Não conectado",
  "settings.connect.connect": "Conectar",
  "settings.connect.reconnect": "Reconectar",
  "settings.connect.disconnect": "Desconectar",
  "settings.connect.running": "Executando…",
  "settings.connect.done": "Pronto.",
  "settings.connect.failed": "Não funcionou. Confira a saída abaixo.",
  "settings.connect.output": "Saída · {command}",
  "settings.connect.cliMissing":
    "O comando {cli} ainda não foi encontrado neste computador.",
  "settings.connect.toolMissing":
    "A ferramenta do hook não foi encontrada. Reconecte para instalá-la de novo.",
  "settings.connect.afterClaude":
    "As sessões do Claude Code que você abrir a partir de agora aparecem no escritório.",
  "settings.connect.afterCodex":
    "No Codex, abra /hooks e confie no hook do Agent Office; senão ele não roda.",
  "settings.connect.afterGemini":
    "As sessões do Gemini CLI que você abrir a partir de agora aparecem no escritório.",
  "settings.connect.needToken":
    "Para conectar, abra esta página pela linha 「Agent Office: http://localhost:4747/?token=…」 no terminal do backend.",
  "settings.connect.notLocal":
    "Este backend pode ser acessado de outras máquinas (Docker, por exemplo), então não consegue conectar agentes. Rode make hooks-install em um terminal.",
  "settings.connect.cannotRun":
    "Este backend não consegue executar o comando de conexão ({reason}). Rode make hooks-install a partir do repositório em um terminal.",
  "settings.connect.busy": "Outra conexão ainda está em andamento.",
  "settings.connect.loadFailed":
    "Não foi possível ler as conexões. O backend está rodando?",

  // Agent Status
  "agentStatus.inQueue": "Na fila {queueType} (posição {position})",

  // Office rooms
  "office.unknownAgent": "Agente",

  // Isometric office
  "iso.live": "LIVE",
  "iso.offline": "OFFLINE",
  "iso.controlsHint":
    "Arraste para mover · Role para ampliar · Clique duplo para redefinir",
  "iso.me": "Eu",
  "iso.agentType.general": "Geral",
  "iso.bubble.thinking": "Pensando",
  "iso.bubble.thinkingFor": "Pensando há {seconds}s",
  "iso.bubble.looking": "Verificando",
  "iso.bubble.bye": "👋 Indo para casa!",
  "iso.bubble.compacting": "☕ Compactando a conversa",
  "iso.panel.project": "Projeto",
  "iso.panel.session": "Sessão",
  "iso.panel.people": "Escritório",
  "iso.panel.atWork": "{count} trabalhando",
  "iso.panel.working": "Trabalhando",
  "iso.panel.tools": "{count} ferramentas · {seconds}s",
  "iso.panel.tools_one": "{count} ferramenta · {seconds}s",
  "iso.panel.colleague": "Outra sessão deste andar · {seconds}s",
  "iso.panel.tools_other": "{count} ferramentas · {seconds}s",
  "iso.panel.log": "Registro de atividade",
  "iso.panel.logTime": "{h}:{m}:{s}",
  "iso.panel.rooms": "Mapa do escritório",
  "iso.room.library": "Biblioteca",
  "iso.room.dev": "Sala de desenvolvimento",
  "iso.room.server": "Sala de servidores",
  "iso.room.search": "Sala de pesquisa",
  "iso.room.meeting": "Sala de reuniões",
  "iso.room.mydesk": "Minha mesa",
  "iso.room.lounge": "Lounge",
  "iso.room.cafe": "Café",
  "iso.room.elevator": "Elevador",
  "iso.roomDoes.library": "Ler · buscar arquivos",
  "iso.roomDoes.dev": "Escrever · editar código",
  "iso.roomDoes.server": "Executar comandos · git",
  "iso.roomDoes.search": "Web · ferramentas externas",
  "iso.roomDoes.meeting": "Planos · tarefas · skills",
  "iso.roomDoes.mydesk": "Perguntas · chamadas para mim",
  "iso.roomDoes.lounge": "Descansar · esperar a próxima pergunta",
  "iso.roomDoes.cafe": "Café antes de ir embora · ao compactar",
  "iso.roomDoes.elevator": "Subagentes chegam e saem",
  "iso.floor.title": "Guia de andares",
  "iso.connect.empty": "Ainda não chegou ninguém.",
  "iso.connect.cta": "Conectar um agente",
  "iso.floor.caption": "DIRETÓRIO",
  "iso.floor.sessions": "{count} sessões",
  "iso.floor.sessions_one": "{count} sessão",
  "iso.floor.sessions_other": "{count} sessões",
  "iso.floor.activeNow": "Ativo agora",
  "iso.floor.follow": "Seguir a sessão mais recente",
  "iso.floor.together": "Ver as outras sessões do andar",
  "iso.floor.untitled": "Sessão sem título · {id}",
  "iso.floor.moreIdle": "Mais {count} andares parados",
  "iso.floor.moreIdle_one": "Mais {count} andar parado",
  "iso.floor.moreIdle_other": "Mais {count} andares parados",
  "iso.floor.lessIdle": "Recolher",

  // Zoom Controls
  "zoom.in": "Aumentar zoom",
  "zoom.out": "Diminuir zoom",
  "zoom.reset": "Resetar zoom",

  // Status Messages
  "status.switchedToSession": "Mudou para sessão {sessionId}...",
  "status.deletingSession": "Excluindo sessão {sessionId}...",
  "status.sessionDeleted": "Sessão excluída.",
  "status.failedDeleteSession": "Falha ao excluir sessão.",
  "status.errorConnecting": "Erro ao conectar ao backend.",
  "status.sessionRenamed": "Sessão renomeada.",
  "status.failedRenameSession": "Falha ao renomear sessão.",
  "status.clearingDatabase": "Limpando banco de dados...",
  "status.databaseCleared": "Banco de dados limpo.",
  "status.failedClearDatabase": "Falha ao limpar banco de dados.",
  "status.triggeringSimulation": "Iniciando simulação...",
  "status.simulationStarted": "Simulação iniciada!",
  "status.failedSimulation": "Falha ao iniciar simulação.",
  "status.storeReset": "Estado resetado.",
  "status.sessionDeletedSwitched": "Sessão excluída. Mudou para {sessionName}",
  "status.sessionDeletedNoOthers":
    "Sessão excluída. Nenhuma outra sessão disponível.",
  "status.connectedTo": "Conectado a {sessionName}",
  "status.autoFollowed": "Seguindo nova sessão: {sessionName}",
};

export default ptBR;
