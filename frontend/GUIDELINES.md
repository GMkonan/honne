> Precedence: module GUIDELINES.md > codebase GUIDELINES.md > defaults. Guidelines tighten the pipeline's guardrails — they can never loosen them.

## Estado da refatoração

- A iniciativa frontend da issue #9 está adiada por decisão do product owner e não bloqueia as funcionalidades planejadas.
- Durante o adiamento, implemente features em módulos próprios e limite mudanças em `App.tsx` e `styles.css` à menor integração necessária; não adicione novas páginas completas, modais, clients de provedores ou persistência a `App`.
- As seções de Zustand, React Router e Tailwind abaixo descrevem o estado-alvo para quando a issue #9 for retomada; não introduza migrações parciais dentro de uma feature sem uma card explícita.
- Preserve o plano e as cards da refatoração para retomada futura; não misture uma refatoração estrutural ampla em PRs de produto.

## Estrutura de arquivos

- Organize o código por tipo técnico em `pages/`, `components/`, `hooks/`, `services/`, `stores/`, `types/` e `styles/`.
- Mantenha `App` como composição fina de providers, router e layout; não coloque nele chamadas HTTP, regras de formulário ou renderização completa de páginas.
- Coloque componentes compartilhados em `components/` somente quando tiverem contrato reutilizável; mantenha componentes exclusivos próximos da página correspondente em uma subpasta da página.
- Mantenha DTOs e modelos reutilizados em `types/`; mantenha tipos locais junto da função ou componente que os usa.

## React e TypeScript

- Escreva componentes como funções com props explicitamente tipadas junto da declaração.
- Use named exports; reserve default export para entrypoints que realmente o exijam.
- Prefixe hooks com `use`, handlers internos com `handle` e callbacks recebidos por props com `on`.
- Não use `React.FC`, `any`, non-null assertions ou casts apenas para suprimir erros do TypeScript.
- Mantenha estado transitório de input, hover e modal no componente mais próximo que o utiliza.

## Estado com Zustand

- Use Zustand como única dependência aprovada para estado global cliente e crie stores separados para Library, navegação/busca e integração AniList.
- Exponha ações explícitas e selectors mínimos; não faça componentes assinarem o store inteiro.
- Mantenha chamadas HTTP nos services; deixe stores coordenarem dados, loading, erro e ações de domínio.
- Não copie para o store estado que possa ser derivado de outros campos de forma barata e determinística.
- Não use middleware de persistência sem uma decisão explícita por estado; nunca persista credenciais ou tokens no navegador.

## Roteamento

- Use React Router com URLs normais como `/library`, `/activity`, `/settings`, `/search` e `/media/:id`; não crie novas rotas por hash.
- Configure e teste fallback SPA no nginx para que toda rota funcione por acesso direto e reload.
- Centralize definição de rotas, parâmetros, página não encontrada, retorno à origem e restauração de foco.
- Faça cada página reconstruir seu estado essencial a partir da URL e da API; não use `sessionStorage` como fonte necessária para abrir uma rota.
- Identifique detalhes externos por provedor, tipo e ID na URL e carregue-os por endpoint backend próprio.
- Atualize redirects OAuth para destinos reais do router e preserve query parameters necessários ao feedback de conexão.

## Services e contratos da API

- Centralize `fetch` em um wrapper tipado e mantenha services separados por domínio.
- Faça toda operação assíncrona aceitar `AbortSignal` e normalize respostas JSON, respostas sem corpo e erros HTTP no wrapper comum.
- Projete requests de create/update em DTOs explícitos; nunca serialize diretamente um objeto completo retornado pelo backend.
- Trate o backend como fonte de verdade e atualize Zustand somente após confirmação da API.
- Atualize o store com a resposta confirmada ou recarregue apenas os recursos afetados pela mutation.
- Não aplique optimistic update a operações destrutivas ou persistentes.

## Requests, polling e concorrência visual

- Cancele requests substituídos, desmontados ou associados a uma query/rota obsoleta.
- Impeça execuções sobrepostas do mesmo polling e pause polling quando `document.visibilityState` não estiver `visible`.
- Verifique a identidade da query ativa antes de publicar um resultado assíncrono no store.
- Desabilite submissão repetida enquanto a mesma mutation estiver em andamento.
- Preserve dados já válidos quando um refresh falhar e mostre a falha sem apagar silenciosamente a tela.

## Tailwind CSS

- Use Tailwind como sistema único de estilos de componentes após a migração; não introduza CSS Modules nem CSS-in-JS em paralelo.
- Quando a issue #9 for retomada, converta todos os estilos legados e remova `styles.css` ao concluir a paridade.
- Mantenha no CSS global somente imports de fontes, reset/base e animações que não sejam expressas adequadamente por utilities.
- Defina no theme cores, tipografia, sombras e espaçamentos recorrentes que preservem a identidade visual atual.
- Construa mobile-first e valide pelo menos 320 px, tablet, desktop e zoom de 200% sem scroll horizontal da página.
- Use valores arbitrários somente para valores realmente únicos; promova repetições ao theme.
- Não adicione helpers de classes como dependência sem aprovação explícita.

## Primitivos e acessibilidade

- Implemente e reutilize primitives para Button, Modal/Dialog, Field, Status e Loading usando HTML semântico.
- Use `button` para ações e `a`/Link para navegação; nunca torne `div` ou `span` clicável para substituir controles nativos.
- Dê nome acessível a todo botão somente com ícone e associe ajuda/erro ao campo correspondente.
- Faça Modal/Dialog definir foco inicial, conter a navegação por Tab, fechar com Escape e restaurar foco ao elemento disparador.
- Anuncie loading, resultados e falhas assíncronas relevantes por uma região de status apropriada sem produzir anúncios repetitivos.
- Cubra interação por teclado, nomes acessíveis e comportamento de foco dos primitives com React Testing Library.

## Feedback ao usuário

- Mostre erros de validação junto ao campo, falhas de página dentro da página e falhas globais/background em região de status acessível.
- Preserve valores digitados quando uma submissão falhar e ofereça retry quando a operação for repetível com segurança.
- Não use `alert()` nem dependa apenas de toast temporário para informação necessária à recuperação.
- Represente loading inicial, refresh, vazio, sucesso parcial e falha como estados distintos.

## Conteúdo externo e credenciais

- Renderize metadata externa como texto React; não use `dangerouslySetInnerHTML` para conteúdo de provedores.
- Permita somente protocolos explicitamente esperados em URLs externas e mostre fallback quando uma capa for ausente ou inválida.
- Use `rel="noopener noreferrer"` em links externos que abram uma nova aba.
- Faça requests da aplicação para endpoints `/api` same-origin; não chame APIs autenticadas de provedores diretamente do navegador.
- Nunca armazene token, senha, client secret ou header de autorização em props, Zustand, `localStorage` ou `sessionStorage`.

## Performance

- Use `loading="lazy"` e dimensões estáveis em capas fora da primeira viewport para evitar layout shift.
- Assine selectors mínimos do Zustand e evite recriar objetos derivados dentro do selector sem necessidade.
- Cancele buscas obsoletas antes de iniciar nova consulta ao mesmo recurso.
- Não adicione memoização, virtualização ou code splitting por padrão; meça o gargalo e registre a evidência no PR antes de introduzi-los.

## Testes frontend

- Use Vitest, React Testing Library, `user-event` e jsdom como stack aprovada de testes frontend.
- No primeiro PR de infraestrutura, fixe as versões dessas dependências, adicione um `deno task test`, atualize o lockfile e inclua o comando frontend em `docs/agents/validation.md`.
- Teste comportamento observável por papel, nome, texto e interação; não selecione nós por classes Tailwind nem afirme detalhes internos do Zustand.
- Mocke a fronteira dos services com respostas explícitas; não execute chamadas reais ao backend ou a provedores.
- Cubra antes da extração os fluxos existentes de rotas, busca, Library, Activity, Settings, detalhes, formulários e modais que serão movidos.
- Adicione regressão para loading, vazio, erro, retry, cancelamento e resposta obsoleta quando alterar código assíncrono.
- Mantenha testes de store independentes de React quando a regra puder ser exercitada pelas ações e selectors.

## Entrega quando a refatoração for retomada

- Mantenha o orçamento de 500 linhas de produção para mudanças de comportamento, estado, services, requests, roteamento, configuração e contratos cross-stack.
- Para a iniciativa de refatoração frontend da issue #9, aplique a exceção aprovada pelo product owner: não imponha teto numérico à card consolidada de extração de componentes e migração visual para Tailwind.
- Limite essa exceção a transformações mecânicas da interface, sem mudanças de regra de produto, estado global, contratos HTTP ou navegação; qualquer mudança fora dessa fronteira continua sujeita ao orçamento de 500 linhas.
- Registre no corpo de todo PR acima do orçamento a contagem exata, a natureza mecânica da mudança e a aprovação da exceção; execute self-review completo mesmo sem reviewer de escalação configurado.
- Faça cada PR preservar build, comportamento e compatibilidade com os arquivos ainda não migrados.
- Separe instalação/configuração de testes, services/types, Zustand/router e primitives em PRs próprios; combine extração de página e Tailwind somente quando a fatia continuar mecanicamente simples.
- Remova código e CSS legados somente no PR em que todos os consumidores correspondentes já tiverem migrado.
- Documente em cada PR os fluxos automatizados e os tamanhos responsivos validados manualmente.
