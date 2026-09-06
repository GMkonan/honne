# Refinamento da experiência visual da Library

## Problem

A Library já permite navegar, filtrar e gerenciar a coleção, mas sua hierarquia
visual ainda não representa bem uma biblioteca pessoal. O hero atual usa uma
identidade genérica, concentra uma frase e estatísticas pouco úteis, e não
explica quem ou o que o avatar representa. Os filtros por tipo comprimem sete
opções em uma única linha, reduzindo capas, labels e contagens. As tags de
status sobre as capas também são pequenas e variam de contraste conforme a cor e
a imagem de fundo.

A ação `Add title` abaixo da busca compete com a busca global como ponto de
entrada para novos títulos. Ela só pode ser removida com segurança depois que a
experiência de busca da issue #3 oferecer uma alternativa explícita para adição
manual.

## Who it's for

Pessoas que mantêm uma instância pessoal do Honne e querem reconhecer sua
própria coleção rapidamente, entender sua dimensão e navegar pelos tipos e
estados de mídia com legibilidade em desktop e mobile.

## Product decisions

- O hero representa a pessoa que mantém a coleção, não a conta AniList nem uma
  identidade separada da instância.
- Nome e avatar são configurados por variáveis de ambiente da instância.
- O banner atual do Honne permanece como fundo, com altura, overlay e composição
  ajustados.
- O perfil mostra somente `Total titles` e `In progress`; não há tagline nem
  dashboard adicional.
- Os filtros de tipo preservam os sete formatos em uma linha no desktop amplo;
  passam para quatro, duas e uma coluna conforme o espaço diminui.
- As tags sobre capas usam texto branco maior, fundo escuro consistente e
  indicador colorido por status.
- Não existe ação persistente `Add title` na Library. O estado vazio mantém seu
  atalho, e a busca global passa a oferecer `Add manually` conforme a issue #3.

## Scope

### In

- Expor ao frontend uma configuração pública e não sensível de perfil da
  instância.
- Adicionar variáveis opcionais para nome e URL do avatar, com defaults seguros
  e documentação em `.env.example` e README.
- Mostrar avatar, nome, `Total titles` e `In progress` no hero pessoal.
- Usar a marca padrão `本音` quando o avatar não for configurado ou quando a
  imagem não puder ser exibida.
- Preservar o banner atual e ajustar sua composição para o novo conteúdo.
- Aumentar área, labels, contagens e legibilidade dos sete filtros de tipo.
- Usar sete colunas no desktop amplo e quatro, duas ou uma coluna conforme o
  espaço disponível, sem rolagem horizontal da página.
- Tornar seleção ativa perceptível sem depender apenas de cor.
- Padronizar todas as tags de status sobre capas com fundo escuro, texto branco
  e indicador colorido acompanhado do label textual.
- Remover o botão `Add title` do toolbar somente depois que a issue #3
  disponibilizar `Add manually` na busca completa.
- Preservar a ação de adição no estado de Library vazia.

### Out

- Upload de avatar ou edição de perfil pela página Settings.
- Nome, avatar, tagline ou banner derivados do AniList.
- Tagline configurável ou estatísticas adicionais.
- Fundo dinâmico baseado nas capas da coleção.
- Redesign completo dos cards de mídia.
- Redesign da busca global além da dependência entregue pela issue #3.
- Favoritos, notícias, recomendações ou discovery sazonal.
- Migração ampla de `App.tsx`, React Router, Zustand ou Tailwind da issue #9.

## Behavior and data

- `PROFILE_NAME` é opcional. Quando definido, contém de 1 a 80 caracteres
  Unicode após trim; valores vazios ou acima do limite falham na inicialização
  sem truncamento silencioso.
- `PROFILE_AVATAR_URL` é opcional e aceita somente URL absoluta com protocolo
  `http` ou `https`; valor inválido ou com credenciais embutidas falha de forma
  explícita na inicialização.
- A ausência de nome usa `My Library`; a ausência ou falha de carregamento do
  avatar usa a marca padrão `本音`.
- A configuração pública não expõe outras variáveis de ambiente nem credenciais.
- `Total titles` corresponde ao tamanho atual da coleção.
- `In progress` corresponde aos itens cujo status local é `in_progress`.
- As estatísticas continuam derivadas da Library carregada e atualizam após
  mutations confirmadas pelo backend.
- Os labels de planejamento permanecem contextuais ao filtro ativo
  (`Plan to read`, `Plan to watch` ou `Plan to read/watch`).

## Success criteria

- O topo da Library comunica claramente uma coleção pessoal configurada pela
  instância.
- Nome, avatar e duas estatísticas continuam legíveis sobre o banner em todos os
  breakpoints suportados.
- Os filtros de tipo apresentam os sete formatos em uma linha no desktop amplo,
  com label e contagem compactos, legíveis e sem truncamento essencial.
- Os filtros permanecem operáveis por teclado, expõem seu estado pressionado e
  possuem alvos interativos de pelo menos 24×24 px.
- Toda tag de status usa texto essencial de pelo menos 12 px, permanece legível
  independentemente da capa e identifica o estado também por texto.
- A Library não apresenta um botão persistente de adição depois que a busca
  oferece a alternativa manual.
- Nenhum fluxo existente de filtro, busca local, ordenação, abertura de detalhes
  ou estado vazio sofre regressão.
- A página funciona em 320 px, tablet, desktop e zoom de 200% sem scroll
  horizontal nem perda de controles essenciais.

## Acceptance criteria

- Dada uma instância com nome e avatar configurados, quando a Library é aberta,
  então ambos aparecem no hero sem depender do AniList ou de storage do
  navegador.
- Dada uma instância sem configuração de perfil, quando a Library é aberta,
  então `My Library` e a marca `本音` são exibidos sem imagem quebrada.
- Dada uma configuração com nome vazio, nome acima de 80 caracteres, URL sem
  `http`/`https` ou URL com credenciais embutidas, quando o backend inicia,
  então a configuração é rejeitada com erro explícito.
- Dada uma coleção carregada, quando itens são adicionados, atualizados ou
  removidos com sucesso, então `Total titles` e `In progress` refletem o estado
  confirmado.
- Dada qualquer opção de tipo, quando recebe foco, hover ou seleção, então
  label, contagem e estado ativo permanecem distinguíveis por mais de uma
  indicação visual.
- Dada uma viewport desktop ampla, quando os filtros são exibidos, então os sete
  formatos ocupam uma linha; em espaços menores passam para quatro, duas e uma
  coluna sem truncar informação essencial.
- Dada qualquer capa clara, escura ou indisponível, quando a tag de status é
  renderizada, então o texto branco sobre fundo escuro continua legível e o
  indicador colorido não é a única informação do estado.
- Dada uma Library vazia, quando a pessoa decide adicionar o primeiro título,
  então o atalho do estado vazio continua disponível.
- Dada uma Library não vazia após a entrega da dependência #3, quando a pessoa
  precisa cadastrar algo que os catálogos não encontram, então pode usar
  `Add manually` na busca completa mesmo sem botão persistente na Library.

## Constraints & dependencies

- A remoção do botão `Add title` depende da issue #3 entregar o fallback
  `Add manually`; não remova a única entrada manual antes disso.
- Antes das mudanças interativas, entregue em card própria a infraestrutura
  aprovada de Vitest, React Testing Library, `user-event` e jsdom,
  reaproveitando seletivamente a PR #15 sem retomar a refatoração ampla.
- A configuração de perfil por `.env` deve funcionar no Docker Compose oficial e
  ser documentada com defaults seguros.
- Integrações e leitura de configuração permanecem no backend; o frontend recebe
  somente os campos públicos necessários.
- URLs e texto configuráveis são entradas não confiáveis e seguem validação,
  escaping e fallback existentes.
- Mudanças devem permanecer em módulos próprios e limitar a integração no
  `App.tsx` e no CSS legado ao mínimo necessário enquanto a issue #9 estiver
  adiada.
- Cada PR permanece dentro do orçamento normal de 500 linhas de
  produção/configuração.
- Ajustes visuais devem atender aos critérios aplicáveis de WCAG 2.2 AA e
  documentar validação responsiva manual.

## Resolved questions

| Question                                        | Decision                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| O hero deve ser compacto, editorial ou pessoal? | Pessoal.                                                                    |
| O perfil representa pessoa, AniList ou coleção? | A pessoa que mantém a instância.                                            |
| Quais estatísticas aparecem?                    | `Total titles` e `In progress`.                                             |
| Onde fica a ação persistente de adição?         | Não existe; estado vazio e busca completa oferecem os caminhos contextuais. |
| Como preservar adição manual?                   | A issue #3 entrega `Add manually` antes da remoção do botão da Library.     |
| Como os filtros de tipo crescem?                | Sete colunas no desktop amplo; quatro, duas e uma em espaços menores.       |
| Como as tags de status ganham contraste?        | Texto branco e maior, fundo escuro e indicador colorido.                    |
| Como nome e avatar são configurados?            | Por `.env`; edição em Settings fica para uma melhoria futura.               |
| Qual fundo acompanha o perfil?                  | O banner atual do Honne.                                                    |
| Existe tagline?                                 | Não; somente nome e duas estatísticas.                                      |
