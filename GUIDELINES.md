> Precedence: module GUIDELINES.md > codebase GUIDELINES.md > defaults. Guidelines tighten the pipeline's guardrails — they can never loosen them.

## Estilo de código

- Formate Go com `gofmt` e valide o frontend com o formatter, linter e TypeScript strict configurados no Deno.
- Escreva nomes, identificadores, comentários técnicos e textos da interface em inglês.
- Comente apenas invariantes, riscos e decisões não óbvias; não repita em prosa o que o código já expressa.
- Prefira funções pequenas e puras para validação, normalização e mapeamentos de domínio.

## Arquitetura

- Preserve a aplicação como dois serviços: SPA frontend e backend Go; não crie microserviços sem uma necessidade operacional comprovada.
- Mantenha credenciais, APIs de metadata, integrações autenticadas e regras de persistência exclusivamente no backend; assets e links públicos podem ser consumidos pelo navegador conforme a política de segurança.
- Crie arquivos próprios para cada nova página, modal, cliente de provedor ou concern de persistência; não adicione essas novas responsabilidades a `App.tsx` ou `main.go`.
- Preserve o backend como monólito modular e dependency-light; não introduza camadas abstratas que tenham apenas uma implementação.

## Práticas gerais

- Valide e normalize dados não confiáveis na fronteira de entrada.
- Limite payloads, paginação e consultas antes de executar trabalho ou chamadas externas.
- Preserve resultados válidos quando operações independentes falharem.
- Nunca ignore erros de persistência nem engula falhas inesperadas silenciosamente.
- Trate textos, URLs, imagens e respostas de provedores como entrada não confiável.

## Infraestrutura

- Mantenha Docker Compose como método oficial de deployment e como contrato operacional reproduzível.
- Preserve healthchecks, volume persistente, `no-new-privileges` e execução com o menor privilégio possível.
- Exija autenticação e HTTPS quando uma instância for exposta fora de uma rede confiável.
- Não adicione Kubernetes, Terraform ou outro sistema de provisionamento sem uma necessidade concreta aprovada.
- Preserve compatibilidade de backup e restore do volume ao alterar caminhos ou formatos persistidos.

## Logging

- Use `log/slog` em novos logs do backend e migre logs antigos somente quando o código relacionado for modificado.
- Use nomes de evento e campos estáveis; registre contexto operacional suficiente para localizar a operação que falhou.
- Nunca registre tokens, senhas, chaves, cookies, headers de autorização ou corpos que possam conter esses valores.
- Registre duração apenas para operações externas ou persistentes relevantes; não produza logs de alta cardinalidade sem utilidade operacional.

## Tratamento de erros

- Retorne erros Go com contexto da operação e preserve a causa com `%w` quando ela precisar ser inspecionada.
- Use `errors.Is` para condições esperadas e traduza erros internos para contratos HTTP somente nos handlers.
- Retorne mensagens HTTP estáveis e acionáveis sem expor detalhes internos ou respostas brutas de provedores.
- Capture erros frontend como `unknown`, normalize-os em um ponto comum e represente estados de loading, vazio e falha na interface.
- Isole falhas de endpoints independentes; não descarte respostas bem-sucedidas porque outra chamada falhou.

## Observabilidade

- Não envie analytics, erros, métricas ou traces para terceiros por padrão.
- Mantenha healthchecks e logs estruturados locais como observabilidade padrão da instalação self-hosted.
- Torne qualquer telemetria futura opcional, explicitamente configurada e documentada com os dados transmitidos.
- Não declare SLOs ou percentis sem medição real que os sustente.

## Feature flags e configuração

- Use variáveis de ambiente apenas para capacidades de deployment, integrações e comportamento operacional.
- Defina defaults seguros e valide grupos de configurações dependentes durante o startup.
- Documente toda nova variável em `.env.example` sem incluir valores secretos reais.
- Não introduza SDK ou serviço remoto de feature flags sem necessidade operacional aprovada.

## Latência, resiliência e idempotência

- Dê contexto e timeout explícito a toda chamada de rede externa.
- Cancele trabalho obsoleto quando o contexto ou a busca correspondente for substituído.
- Execute operações externas independentes concorrentemente quando isso reduzir espera sem comprometer limites do provedor.
- Preserve resultados parciais de discovery e identifique provedores indisponíveis ao usuário.
- Faça o startup falhar diante de configuração inválida, store ilegível, versão incompatível ou credenciais parcialmente configuradas.
- Mantenha a Library local utilizável durante indisponibilidade de provedores opcionais.
- Modele escritas remotas como trabalho durável, idempotente, vinculado à conta correta e com retry/backoff limitado.
- Nunca faça uma escrita local depender do sucesso imediato de um provedor externo.

## Dependências

- Prefira a standard library, APIs da plataforma, React e dependências já aprovadas.
- Solicite aprovação explícita antes de adicionar qualquer pacote ausente do lockfile.
- Justifique uma nova dependência pelo risco ou complexidade que ela elimina; não a adicione apenas por conveniência.
- Declare versões intencionais; não introduza nem preserve `latest` ao modificar um manifest.
- Corrija declarações `latest` preexistentes em uma card própria, sem ampliar o escopo de PRs não relacionados.
- Atualize e revise o lockfile junto de qualquer alteração de dependência.

## Dados e migrations

- Persista coleção, atividades, contadores e outbox afetados por uma operação como uma única unidade atômica.
- Restaure completamente o estado em memória quando a persistência falhar; nunca confirme sucesso antes da gravação.
- Versione mudanças no formato persistido e mantenha um caminho explícito de leitura/migração para estados suportados.
- Faça migrations additive-first quando possível e nunca destrua dados silenciosamente.
- Entregue migration, código consumidor e testes de upgrade, restart e rollback no mesmo PR.
- Documente backup e recuperação antes de qualquer mudança incompatível.
- Preserve IDs referenciados por tombstones e reconstrua contadores considerando todo estado durável.
- Preserve arrays vazios como `[]`, não `null`, nos contratos JSON existentes.

## Segurança

- Trate tokens, senhas e chaves como secrets cuja exposição bloqueia release.
- Armazene secrets com permissões restritivas e nunca os envie ao frontend quando não forem necessários.
- Nunca coloque secrets em URLs, logs, commits, imagens ou exemplos de configuração.
- Mantenha Basic Auth opcional para redes confiáveis, mas exija autenticação e HTTPS para exposição pública.
- Use comparação constante para credenciais e proteja OAuth com estado, expiração e cookies adequados ao transporte.
- Rejeite campos JSON desconhecidos e aplique limites de tamanho antes de decodificar requisições.

## Testes e validação

- Mantenha testes backend determinísticos e autocontidos com `testing`, `httptest` e `t.TempDir`; nunca contate provedores reais.
- Execute o backend com `go test -race ./...` e `go vet ./...` antes de abrir um PR.
- Adicione testes de restart, rollback, concorrência e compatibilidade a toda alteração de persistência ou outbox.
- Cubra timeouts, respostas inválidas, falhas parciais e idempotência ao alterar integrações externas.
- Adicione testes automatizados para fluxos frontend críticos de navegação, busca, modal e acessibilidade após a aprovação da stack de testes frontend.
- Documente validação manual reproduzível para comportamento frontend enquanto essa stack ainda não existir.
- Execute lint, typecheck, build frontend e validação do Docker Compose antes de abrir um PR.

## Acessibilidade frontend

- Atenda aos critérios WCAG 2.2 AA aplicáveis em toda interface nova ou alterada e documente a validação manual ou automatizada no PR.
- Garanta operação completa por teclado e nunca comunique estado somente por cor.
- Não use texto essencial abaixo de 12 px nem controles cujo alvo interativo seja menor que 24 por 24 px sem justificar e validar uma alternativa acessível.
- Gerencie foco inicial, contenção, Escape e restauração de foco em modais.
- Anuncie mudanças assíncronas relevantes com semântica acessível.
- Respeite `prefers-reduced-motion` e preserve foco visível.

## Idioma e rotas frontend

- Escreva todo texto visível da interface em inglês enquanto não houver uma decisão explícita de internacionalização.
- Mantenha identificadores de rota estáveis e independentes do idioma exibido.
- Dê URL estável a toda experiência tratada como página e faça-a sobreviver a reload, deep link e navegação voltar/avançar.
- Mova foco e scroll de forma previsível após mudanças de rota.
- Mantenha estado temporário fora da URL apenas quando ele não precisar sobreviver a reload nem ser compartilhado.

## Git e pull requests

- Crie branches a partir do ID da card ou issue e nunca implemente diretamente em `main`.
- Use commits pequenos com Conventional Commits (`feat:`, `fix:`, `test:`, `docs:` ou `chore:`).
- Vincule todo PR à card/issue correspondente e descreva contexto, mudanças e comandos de validação.
- Limite cada PR a 500 linhas de produção alteradas; obtenha aprovação e documente a justificativa antes de exceder o limite.
- Nunca faça force-push, ignore hooks ou aprove/mescle o próprio PR.

## Criticidade do domínio

- Classifique como crítico qualquer risco de perder ou corromper coleção, atividades ou fila de sincronização.
- Classifique como crítico confirmar uma alteração que não foi persistida de forma durável.
- Classifique como crítico impedir uma instância existente de iniciar após atualização por falta de compatibilidade ou migration.
- Classifique como crítico alterar ou excluir dados na conta AniList errada.
- Classifique como crítico expor tokens, senhas ou chaves.
- Trate indisponibilidade de metadata providers e defeitos puramente visuais abaixo de crítico quando os dados e operações locais permanecerem seguros.
