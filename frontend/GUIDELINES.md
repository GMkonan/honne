> Precedence: module GUIDELINES.md > codebase GUIDELINES.md > defaults. Guidelines tighten the pipeline's guardrails — they can never loosen them.

## Organização

- Implemente novas páginas, modais, clients de provedores e regras de domínio em módulos próprios; mantenha a integração em `App.tsx` e `styles.css` tão pequena quanto possível.
- Mantenha componentes compartilhados em `components/` somente quando tiverem um contrato reutilizável; mantenha código exclusivo próximo da experiência que o utiliza.
- Mantenha DTOs e modelos reutilizados em tipos compartilhados; mantenha tipos locais junto da função ou componente correspondente.
- Não misture uma refatoração estrutural ampla com uma mudança de produto sem aprovação explícita.

## React e TypeScript

- Escreva componentes como funções com props explicitamente tipadas junto da declaração.
- Use named exports; reserve default export para entrypoints que realmente o exijam.
- Prefixe hooks com `use`, handlers internos com `handle` e callbacks recebidos por props com `on`.
- Não use `React.FC`, `any`, non-null assertions ou casts apenas para suprimir erros do TypeScript.
- Mantenha estado transitório de input, hover e modal no componente mais próximo que o utiliza.
- Não duplique estado que possa ser derivado de forma barata e determinística.

## Navegação e URLs

- Dê URL estável a toda experiência tratada como página e preserve reload, deep link e navegação voltar/avançar.
- Centralize parsing e geração de rotas; não espalhe manipulação direta da URL por componentes.
- Reconstrua o estado essencial de uma página a partir da URL e da API; não use storage do navegador como requisito para abrir uma rota.
- Mova foco e scroll de forma previsível após mudanças de rota.
- Preserve query parameters necessários a retornos de OAuth e feedback de conexão.

## Services e contratos da API

- Centralize `fetch` em uma fronteira tipada e mantenha services separados por domínio.
- Faça toda operação assíncrona cancelável com `AbortSignal` e normalize respostas JSON, respostas sem corpo e erros HTTP em um ponto comum.
- Projete requests de create/update em DTOs explícitos; não serialize diretamente um objeto completo retornado pelo backend.
- Trate o backend como fonte de verdade e atualize o estado cliente somente após confirmação da API.
- Atualize apenas os recursos afetados pela mutation ou recarregue-os quando isso for mais seguro.
- Não aplique optimistic update a operações destrutivas ou persistentes.

## Requests e concorrência visual

- Cancele requests substituídos, desmontados ou associados a uma query ou rota obsoleta.
- Impeça execuções sobrepostas do mesmo polling e pause polling quando `document.visibilityState` não estiver `visible`.
- Verifique a identidade da query ativa antes de publicar um resultado assíncrono.
- Desabilite submissão repetida enquanto a mesma mutation estiver em andamento.
- Preserve dados já válidos quando um refresh falhar e mostre a falha sem apagar silenciosamente a tela.

## Acessibilidade e responsividade

- Use HTML semântico: `button` para ações e `a` para navegação; não substitua controles nativos por `div` ou `span` clicável.
- Dê nome acessível a todo botão somente com ícone e associe ajuda ou erro ao campo correspondente.
- Faça modais definirem foco inicial, conterem a navegação por Tab, fecharem com Escape e restaurarem foco ao elemento disparador.
- Anuncie loading, resultados e falhas assíncronas relevantes sem produzir anúncios repetitivos.
- Garanta operação completa por teclado, foco visível e informação que não dependa apenas de cor.
- Respeite `prefers-reduced-motion`.
- Construa mobile-first e valide pelo menos 320 px, tablet, desktop e zoom de 200% sem scroll horizontal da página.

## Feedback ao usuário

- Mostre erros de validação junto ao campo, falhas de página dentro da página e falhas globais ou de background em região de status acessível.
- Preserve valores digitados quando uma submissão falhar e ofereça retry quando a operação puder ser repetida com segurança.
- Não use `alert()` nem dependa apenas de toast temporário para informação necessária à recuperação.
- Represente loading inicial, refresh, vazio, sucesso parcial e falha como estados distintos.

## Conteúdo externo e credenciais

- Renderize metadata externa como texto React; não use `dangerouslySetInnerHTML` para conteúdo de provedores.
- Permita somente protocolos explicitamente esperados em URLs externas e mostre fallback quando uma capa estiver ausente ou inválida.
- Use `rel="noopener noreferrer"` em links externos que abram uma nova aba.
- Faça requests da aplicação para endpoints `/api` same-origin; não chame APIs autenticadas de provedores diretamente do navegador.
- Nunca armazene token, senha, client secret ou header de autorização em props, estado cliente, `localStorage` ou `sessionStorage`.

## Performance

- Use `loading="lazy"` e dimensões estáveis em capas fora da primeira viewport para evitar layout shift.
- Cancele buscas obsoletas antes de iniciar nova consulta ao mesmo recurso.
- Não adicione memoização, virtualização ou code splitting por padrão; meça o gargalo e registre a evidência antes de introduzi-los.

## Testes frontend

- Use Vitest, React Testing Library, `user-event` e jsdom para testes frontend.
- Teste comportamento observável por papel, nome, texto e interação; não selecione nós por classes de estilo nem afirme detalhes internos de implementação.
- Mocke a fronteira dos services com respostas explícitas; não execute chamadas reais ao backend ou a provedores.
- Adicione regressão para loading, vazio, erro, retry, cancelamento e resposta obsoleta ao alterar código assíncrono.
- Cubra interação por teclado, nomes acessíveis e comportamento de foco ao alterar componentes interativos.
