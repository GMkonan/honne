# Refatoração da fundação frontend

## Problem

O frontend cresceu com páginas, estado, navegação, integrações, formulários e estilos fortemente concentrados. Essa concentração aumenta o risco de regressões, dificulta testar comportamentos isoladamente e torna mudanças nas próximas iniciativas de Library, busca, detalhes, favoritos e discovery maiores do que deveriam ser.

A continuidade das funcionalidades sobre essa base ampliaria o custo de manutenção e faria as novas tasks dependerem de uma estrutura que já precisa ser substituída.

## Who it's for

O benefício direto é para mantenedores e contribuidores do Honne, que precisam evoluir áreas independentes com mudanças menores, compreensíveis e testáveis. Usuários de instâncias self-hosted são beneficiários indiretos por receberem atualizações com menor risco de regressão e perda de funcionalidade.

## Success criteria

- A composição principal deixa de concentrar regras de página, estado, chamadas remotas, formulários e apresentação.
- Estilos e comportamentos ficam isolados por responsabilidades claras, sem dois sistemas permanentes para a mesma finalidade.
- URLs de páginas podem ser abertas diretamente, recarregadas e navegadas com voltar/avançar.
- Detalhes de catálogo externo podem ser reconstruídos a partir da URL sem depender de estado temporário de uma busca anterior.
- Os fluxos principais existentes possuem proteção automatizada contra regressão.
- A identidade visual e as regras de produto atuais permanecem equivalentes, exceto por ajustes mínimos necessários para acessibilidade.
- Cada etapa permanece executável e atende ao contrato de validação do projeto.
- Não serão usados percentuais artificiais de cobertura nem limites arbitrários de linhas por arquivo como medida de sucesso.

## Scope

### In

- Reorganizar o frontend em responsabilidades independentes para páginas, componentes compartilhados, estado, navegação, acesso à API, tipos e estilos.
- Criar uma base automatizada de testes comportamentais antes de mover fluxos existentes.
- Centralizar acesso à API e tratamento de respostas, falhas, cancelamento e estados assíncronos.
- Separar estado global de estado temporário de interface e impedir que credenciais sejam persistidas no navegador.
- Substituir navegação baseada em estado temporário por rotas estáveis e recarregáveis.
- Permitir que detalhes externos sejam recuperados novamente a partir da identidade presente na URL.
- Criar primitives reutilizáveis para controles, campos, loading, status e diálogos acessíveis.
- Substituir integralmente o sistema legado de estilos, preservando o design atual e o comportamento responsivo.
- Executar a migração em etapas pequenas, funcionais e verificáveis.

### Out

- Redesenhar a Library, a busca ou as páginas de detalhes.
- Adicionar favoritos, notícias, discovery sazonal ou integrações de disponibilidade.
- Alterar regras de status, progresso, rating, importação ou sincronização.
- Migrar a persistência backend para SQLite.
- Corrigir no mesmo esforço todas as dívidas técnicas gerais do backend.
- Introduzir mudanças visuais oportunistas que não sejam necessárias para acessibilidade ou paridade.

## Acceptance criteria

- Dado o mesmo estado de Library, quando o usuário filtra, ordena, adiciona, edita ou exclui uma mídia, então o resultado observado permanece equivalente ao comportamento anterior.
- Dado o histórico existente, quando o usuário abre Activity e seleciona uma entrada válida, então a timeline e a navegação para detalhes continuam funcionando.
- Dada uma busca válida, quando provedores respondem total ou parcialmente, então resultados locais e externos, indisponibilidades e retry continuam representados corretamente.
- Dado um item local ou externo, quando sua URL de detalhes é aberta diretamente ou recarregada, então a página recupera o conteúdo correto sem depender de uma navegação anterior.
- Dada a área Settings, quando o usuário conecta ou desconecta AniList, importa uma lista, repete jobs ou descarta uma fila, então as proteções e feedbacks atuais permanecem disponíveis.
- Dada qualquer página principal, quando o usuário navega por links, voltar ou avançar, então URL, conteúdo, foco e histórico permanecem coerentes.
- Dado um usuário de teclado, quando interage com navegação, formulários e diálogos, então todos os controles são alcançáveis, possuem nome acessível e administram foco corretamente.
- Dada uma falha de API, quando uma operação pode ser repetida, então o conteúdo válido e os dados digitados são preservados e uma ação de retry é apresentada quando segura.
- Dada uma viewport de 320 px, tablet ou desktop, ou zoom de 200%, quando qualquer fluxo principal é usado, então não existe scroll horizontal da página nem perda de controles essenciais.
- Dada uma diferença visual necessária para contraste, foco, alvo interativo ou semântica, quando ela for introduzida, então permanece mínima, documentada e não amplia o trabalho para um redesign.
- Dada qualquer etapa intermediária da refatoração, quando o contrato de validação é executado, então a aplicação continua compilando, testável e operacional antes da etapa seguinte.

## Constraints & dependencies

- Seguir as guidelines raiz e frontend aprovadas no projeto.
- Preservar comportamento, regras de produto e identidade visual durante todo o trabalho.
- Dividir a iniciativa em PRs funcionais com no máximo 500 linhas de produção alteradas cada.
- Fixar versões e atualizar o lockfile ao introduzir dependências já aprovadas para estado, estilos, rotas e testes.
- Estabelecer testes de caracterização antes de extrair cada fluxo relevante.
- Coordenar um endpoint backend para recuperar detalhes externos por identidade estável.
- Atualizar o retorno OAuth para uma rota real da área Settings.
- Manter compatibilidade entre áreas migradas e legadas apenas durante a sequência de transição.
- Não iniciar as funcionalidades planejadas nas issues #2–#7 antes da conclusão desta iniciativa.

## Open questions

| Question | Owner | Status |
|---|---|---|
| Quem é o beneficiário direto da refatoração? | Product owner | Resolvida — mantenedores e contribuidores |
| O sucesso exige meta numérica de cobertura ou tamanho de arquivo? | Product owner | Resolvida — não; usar critérios estruturais e comportamentais |
| Ajustes visuais por acessibilidade são permitidos durante a paridade? | Product owner | Resolvida — somente ajustes mínimos e documentados |
| Quais fluxos atuais são críticos para regressão? | Product owner | Resolvida — Library, Activity, busca, detalhes, navegação, Settings e AniList |
| Detalhes externos podem depender de estado temporário do navegador? | Product owner | Resolvida — não; devem ser reconstruídos pela URL e API |
