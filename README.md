# shall

CLI para avaliar comandos de shell antes de agentes de programação os executarem. O Shall normaliza os eventos recebidos, classifica o comando com regras locais e Google Gemini, permite ações reversíveis e espera pela decisão do developer para as restantes. Uma falha de configuração ou avaliação bloqueia a ação.

## Requisitos

- Node.js 20 ou superior;
- CouchDB inicializado com `shall init`;
- chave da API Google Gemini;
- Twilio configurada para aprovações por chamada;
- um agente com hook síncrono anterior à execução.

## Configuração

1. Instala as dependências com `npm ci`.
2. Copia `.env.example` para `.env` e configura CouchDB, Gemini, Twilio e `PUBLIC_URL`.
3. Compila e instala a CLI: `npm run build` e `npm link`.
4. Corre `shall init` e adiciona os developers à equipa.
5. Mantém `shall daemon` ativo. Este processo recebe os webhooks da Twilio e da API; não inicia nenhum agente.
6. Configura o hook de pré-execução do agente para chamar `shall hook check --adapter <nome>` com o JSON do evento em stdin.

## Adaptadores de shell

O núcleo usa um protocolo comum (`command`, `cwd`, `agent`) e traduz as respostas para os formatos reconhecidos pelos hooks dos agentes. Os adaptadores atuais são `codex`, `claude`, `cursor`, `gemini` e `shall` (protocolo comum). Configura o matcher do hook para chamar o Shall apenas para ferramentas de shell.

Exemplo para Codex em `.codex/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^Bash$",
        "hooks": [
          {
            "type": "command",
            "command": "shall hook check --adapter codex",
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```

Exemplo para Claude Code em `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "shall hook check --adapter claude", "timeout": 600 }
        ]
      }
    ]
  }
}
```

Exemplo para Cursor em `.cursor/hooks.json`:

```json
{
  "version": 1,
  "hooks": {
    "beforeShellExecution": [
      {
        "command": "shall hook check --adapter cursor",
        "timeout": 600,
        "failClosed": true
      }
    ]
  }
}
```

O hook do Gemini CLI deve ser ligado ao evento síncrono `BeforeTool` e à ferramenta de shell, chamando `shall hook check --adapter gemini`. Confirma na versão instalada do Gemini CLI a estrutura de configuração e as permissões dos hooks antes de ativá-lo.

O adaptador `shall` aceita este evento JSON:

```json
{"command":"git status","cwd":"/caminho/do/projeto","agent":"coding-agent"}
```

Os adaptadores de Cursor, Gemini CLI, Claude Code e Codex refletem os formatos documentados dos seus hooks de shell pré-execução. [Codex](https://learn.chatgpt.com/docs/hooks), [Claude Code](https://code.claude.com/docs/en/hooks), [Cursor](https://prod.cursor.com/docs/hooks), [Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md).

## Limites atuais

- A avaliação partilhada cobre comandos de shell que passam pelo hook configurado. Ferramentas de edição de ficheiros, MCP, browser e operações internas do agente precisam de hooks e avaliadores próprios.
- Cada agente precisa de uma pequena configuração que encaminhe o evento para o adaptador correspondente. Agentes sem hook bloqueante pré-execução não podem ser integrados com a mesma garantia.
- Hooks de comandos em ambientes hospedados só conseguem chamar um Shall acessível nesse ambiente ou um endpoint remoto. Uma CLI local não intercepta automaticamente comandos executados num container remoto.
- `shall daemon` mantém o endpoint público dos webhooks ativo; as chamadas/SMS continuam sujeitas aos limites da conta Twilio.

## Desenvolvimento

- `npm run build`: compila o TypeScript, sem depender de `ptrace` ou de um compilador C.
- `npm test`: executa o build e os testes.
- `shall --help`: lista os comandos disponíveis.

## Painel beta local

1. Copy `.env.example` to `.env` and configure the CLI and CouchDB settings.
2. Start the dashboard API with `shall dashboard` (or `npm run dev -- dashboard` during development).
3. In `Downloads/shall-website`, run `npm install` and `npm run dev`.
4. Open the Vite URL and sign up or sign in. The site proxies dashboard requests to `127.0.0.1:3301`.

Each account has its own tenant and can only read that tenant's activity and team. The tenant key is shown after signup or rotation. Set `SHALL_TENANT_API_KEY` in `.env` to associate this installation's hooks with the account, then run `shall daemon` for hooks. The release preference is saved per tenant, but automatic package distribution and updates are not connected. Downloads have no telemetry yet.

Paddle is only prepared through environment variables (`PADDLE_ENVIRONMENT`, `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET`). Checkout, prices, subscriptions and webhooks are not implemented; no charges are active. The API binds to `127.0.0.1` and must not be exposed to the internet.
