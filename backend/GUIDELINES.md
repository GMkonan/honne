> Precedence: module GUIDELINES.md > codebase GUIDELINES.md > defaults. Guidelines tighten the pipeline's guardrails — they can never loosen them.

## Fronteira da persistência

- Mantenha o `store` como única autoridade sobre estado, locking, IDs e persistência; nenhum handler, worker ou integração deve abrir ou alterar o arquivo de dados diretamente.
- Exponha novas operações de domínio por métodos do `store`; mantenha structs e serialização específicas do JSON dentro da camada de persistência.
- Continue usando JSON durante o MVP; não crie uma interface genérica de repository antes do projeto explícito de migração para SQLite.
- Trate SQLite como evolução planejada quando consultas, relações, volume ou múltiplos usuários justificarem a mudança; não introduza PostgreSQL ou outro serviço obrigatório para resolver o mesmo caso single-instance.

## Durabilidade do snapshot

- Grave o snapshot em arquivo temporário no mesmo diretório; sincronize e feche o arquivo com sucesso, faça rename atômico e sincronize o diretório antes de confirmar a persistência.
- Propague falhas de escrita, `Sync`, `Close`, `Rename` e sync do diretório; remova o temporário quando uma etapa falhar.
- Propague e trate toda falha de persistência, inclusive transições executadas pelo worker AniList; nunca descarte o retorno de `persistLocked`.
- Mantenha a mutação em memória e sua outbox/atividade na mesma região crítica e restaure todos os campos e contadores afetados quando a gravação falhar.
- Preserve o `media.json` original como fonte recuperável durante uma futura migração para SQLite e mantenha os IDs existentes.

## Concorrência

- Acesse todo estado compartilhado do `store` sob `sync.RWMutex`; use lock de leitura somente para operações que não mutam slices, jobs ou contadores.
- Nunca mantenha o mutex do `store` durante chamadas de rede.
- Faça workers copiarem o trabalho sob lock, liberarem o lock para executar I/O externo e validarem novamente ID, geração e conta antes de persistir o resultado.
- Dê cancelamento ou ciclo de vida explícito a toda goroutine iniciada pelo backend.
- Execute `go test -race ./...` para toda mudança que toque estado, cache, workers ou handlers concorrentes.

## Contratos HTTP

- Aceite e produza JSON nos endpoints de aplicação e defina `Content-Type: application/json` nas respostas com corpo; use redirects somente quando exigidos por protocolos como OAuth e respostas sem corpo para `204` ou healthchecks.
- Limite request bodies, rejeite campos JSON desconhecidos e conclua a validação antes de adquirir locks de escrita ou alterar o `store`.
- Use `400` para sintaxe/parâmetros inválidos, `404` para recurso ausente, `409` para conflito de estado, `422` para violação de regra de domínio e `5xx` para falha interna ou indisponibilidade externa.
- Retorne listas vazias como `[]`, nunca `null`, e aplique `Cache-Control: no-store` às respostas da API.
- Preserve as rotas `/api` atuais; introduza uma nova versão somente quando houver uma mudança incompatível que não possa ser migrada.

## Servidor HTTP

- Use `http.Server` com timeouts explícitos de header, leitura, escrita e conexão ociosa; não dependa apenas do nginx para limitar clientes lentos.
- Trate sinais de encerramento parando novas requisições e dando prazo limitado para handlers em andamento terminarem.
- Encerre workers de background pelo mesmo contexto de shutdown antes de finalizar o processo.

## Integrações externas

- Implemente cada provedor em um client/service próprio com `http.Client`, contexto, timeout e validação explícita de status e payload.
- Faça discovery falhar rapidamente, sem retries longos, e preserve resultados dos outros tipos quando um provedor estiver indisponível.
- Faça mutações externas passarem por outbox persistida antes da chamada e use retry com backoff limitado.
- Nunca execute testes contra AniList, TMDB, Open Library ou qualquer serviço real; use `httptest.Server` com respostas sintéticas.

## Sincronização AniList

- Mantenha separados o ID local do Honne, o media ID global do AniList, o media-list-entry ID específico da lista e o user ID da conta.
- Vincule todo job persistido ao AniList user ID que o originou e pause-o, sem chamada remota, quando outra conta estiver conectada.
- Mantenha imports públicos como `local_only`; só persista list-entry IDs obtidos para a conta autenticada correspondente.
- Faça deleções remotas idempotentes e trate uma entrada já ausente como sucesso.
- Bloqueie troca/desconexão normal enquanto houver jobs; descarte-os somente após uma ação explícita do usuário.
- Preserve geração de job e ignore conclusões obsoletas sem apagar ou penalizar trabalho mais novo.

## OAuth AniList

- Execute Authorization Code Grant integralmente no backend; nunca entregue access token ou client secret ao frontend.
- Valide state aleatório e expirável contra cookie HttpOnly/SameSite e marque o cookie `Secure` quando o redirect usar HTTPS.
- Exija correspondência exata do redirect configurado e rejeite respostas OAuth incompletas.
- Persista autorização separadamente do estado da Library, com permissão `0600`, e remova o arquivo ao desconectar com sucesso.

## Identidade de mídia

- Use inteiros locais monotônicos, preserve-os em migrations e nunca reutilize IDs ainda referenciados por items, activities, jobs ou tombstones.
- Não introduza UUID enquanto não existir sincronização entre múltiplas instâncias ou outra fonte real de colisões distribuídas.
- Torne `type`, `provider` e `providerId` imutáveis em updates comuns.
- Altere identidade externa somente por um fluxo explícito de vincular, desvincular ou corrigir metadata que valide efeitos sobre outbox e conta conectada.

## Testes Go

- Use a standard library (`testing`, `httptest`, `t.TempDir` e `t.Setenv`) como padrão; não adicione framework de assertions ou mocks sem necessidade aprovada.
- Teste comportamento por contratos HTTP e estado reaberto do disco, não por detalhes internos frágeis.
- Reabra o `store` em testes que afirmem durabilidade, migrations, counters, tombstones ou filas.
- Simule falha de escrita e verifique rollback completo quando uma operação alterar múltiplas partes do snapshot.
- Cubra conta errada, geração obsoleta, retry, entrada remota ausente e restart ao modificar sincronização.
