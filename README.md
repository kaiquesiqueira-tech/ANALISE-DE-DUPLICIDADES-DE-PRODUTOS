# Duplicidade de Cadastro — Protheus

Painel para analisar produtos duplicados no cadastro do Protheus, cruzando três tabelas:

- **SB1**, o cadastro de produtos;
- **SBZ**, com o ponto de pedido;
- **Saldo Físico (SB2)**, com o saldo e a previsão de chegada.

Ele é feito para quem cuida do cadastro **bloquear os produtos duplicados**. São três telas:

- **Bloquear** (abre direto nela): a lista do que bloquear. Cada linha diz **BLOQUEAR** este → **MANTER** aquele, com o motivo (o que fica está em uso ou tem a compra mais recente). Cada par aparece uma vez só. Primeiro vêm os mais seguros (95–100% com o similar em uso), depois 95–100% com os dois livres e por último 80–94%. Bloqueou no Protheus, marca **Bloqueei** e a linha sai da lista. Avisos só quando precisa: NCM diferente ou grupo diferente. Filtros: semelhança, grupo e busca; Excel da lista.
- **Resumo**: indicadores, "Onde agir", **evolução** (quantos faltam bloquear: começa no tamanho da lista da primeira base, cai na hora a cada bloqueio marcado — sem precisar atualizar a base — e sobe quando uma base nova traz duplicidades novas; as linhas tracejadas marcam cada atualização da base), andamento detalhado dos bloqueios, gráficos por empresa e histórico de medições.
- **Não bloquear**: produtos com saldo, previsão de chegada ou ponto de pedido que têm similar.

Também mostra o **NCM** (campo Pos.IPI/NCM da SB1, com a descrição da tabela mata010) e o **grupo** (com a descrição da tabela de grupos de cada empresa).

Dá para **instalar como aplicativo** no computador ou no celular (veja *Instalar como aplicativo*).

Tudo roda no navegador: não precisa de servidor nem de banco de dados.

## Estrutura

```
index.html                 página do painel
manifest.webmanifest       nome, cores e ícones do app instalado
sw.js                      service worker: instalação e abertura sem internet
icones/                    ícones do app (computador, Android e iPhone)
css/estilo.css             visual
js/simcore.js              cálculo de similaridade
js/xlsxstream.js           leitura das planilhas .xlsx/.csv
js/analise.js              regras (faixas, saldo, previsão, ponto de pedido, filiais)
js/xlsxwriter.js           exportação das listas em Excel (.xlsx)
js/armazenamento.js        histórico (pasta dados/ + navegador)
js/app.js                  telas, gráficos e tabelas
dados/historico.json       resumo de todas as medições (alimenta a evolução)
dados/bloqueios.json       produtos marcados como bloqueados (andamento dos bloqueios)
dados/ncm.json             tabela de NCM: código → descrição (vem da exportação mata010)
dados/grupos.json          tabelas de grupos por empresa: código → descrição (02 e 10 separadas)
dados/medicoes/*.json      detalhe de cada medição (produtos e pares)
scripts/processar.js       mesmo processamento do site, via Node.js
scripts/publicar.js        usado pelo PUBLICAR: processa a pasta planilhas/ e junta os arquivos baixados
PUBLICAR.bat               publica no GitHub com dois cliques (sem VS Code)
.github/workflows/         opção automática pelo GitHub Actions
planilhas/                 onde colocar as exportações do Protheus antes de rodar o PUBLICAR
```

## Publicar no GitHub Pages

1. Crie um repositório no GitHub (ex.: `app-duplicidades`) e envie **todos** os arquivos desta pasta, inclusive as pastas `.github` e `dados`.
   - No site do GitHub: **Add file → Upload files** e arraste o conteúdo da pasta.
   - O arquivo `.nojekyll` precisa ir junto.
2. No repositório, abra **Settings → Pages**. Em *Build and deployment* escolha **Deploy from a branch**, branch **main**, pasta **/ (root)** e clique em **Save**.
3. Em 1 a 2 minutos o endereço aparece no topo da página de Pages, no formato `https://SEU-USUARIO.github.io/app-duplicidades/`.

> ⚠️ **Dados da empresa.** Na conta gratuita, o GitHub Pages só funciona com repositório **público**. Nesse caso, qualquer pessoa com o link vê os arquivos de `dados/` (códigos, descrições e saldos) e de `planilhas/`. Se os dados não podem ficar públicos, use um repositório **privado** num plano que permita Pages privado (GitHub Enterprise) ou não envie a pasta `dados/medicoes/`. Sem ela, cada pessoa carrega as planilhas no próprio navegador e o histórico fica só nele.

## Atualizar a base (nova medição)

### Opção A — pela pasta `planilhas` + PUBLICAR (recomendada)

1. Exporte do Protheus a **SB1**, a **SBZ** e o **Saldo Físico** de cada empresa (.xlsx ou .csv). Se a tabela de NCM mudou, exporte também o **mata010** (opcional). Se os grupos mudaram, exporte a **tabela de grupos de cada empresa** com a empresa no nome do arquivo, por exemplo `mata010 02.xlsx` e `mata010 10.xlsx` (opcional).
2. Coloque os arquivos na pasta **`planilhas`**, dentro da pasta do app (pode ser numa subpasta dela). O nome dos arquivos não importa: o PUBLICAR identifica cada planilha sozinho. Planilha deixada por engano na pasta principal do app é levada para `planilhas`.
3. Dê dois cliques no **PUBLICAR.bat**. Ele:
   - busca o que já está no GitHub;
   - calcula a medição **no seu computador**, com o mesmo motor do site (cerca de 20 segundos);
   - grava o resultado em `dados/` e guarda as planilhas usadas em `planilhas/processadas/<data>/`;
   - publica no GitHub. Em 1 a 2 minutos todo mundo vê o novo ponto na evolução.
4. Leia a **faixa final** da janela: **BASE ATUALIZADA E PUBLICADA** quer dizer que a medição nova foi enviada. Se aparecer **ATENÇÃO: A BASE NÃO FOI ATUALIZADA**, a linha de baixo diz o motivo. Tudo o que apareceu na janela fica também no arquivo **`PUBLICAR-log.txt`**, na pasta do app.

As planilhas **não vão para o GitHub**: a pasta `planilhas/` está no `.gitignore`, e só o resultado é enviado.

O PUBLICAR confere as planilhas antes de gravar e **não grava a medição** se:

- faltar a SB1, a SBZ ou o Saldo Físico de alguma empresa que está na SB1. Sem eles, produtos com saldo, previsão ou ponto de pedido apareceriam como livres para bloquear;
- houver duas planilhas do mesmo tipo para a mesma empresa (por exemplo, um Saldo Físico antigo esquecido na pasta);
- alguma planilha estiver aberta no Excel;
- nenhuma planilha for reconhecida (arquivo .xls antigo, por exemplo: abra no Excel e salve como .xlsx).

Nesses casos, as planilhas continuam na pasta e a faixa final mostra **ATENÇÃO: A BASE NÃO FOI ATUALIZADA** com o motivo. O resto (marcações, tabela de NCM, histórico) é publicado normalmente. Corrija e rode o PUBLICAR de novo.

**Dados protegidos:** se arquivos de `dados/` forem apagados na pasta (ou já tiverem sido publicados apagados), o PUBLICAR traz de volta do histórico do GitHub as medições apagadas e o `bloqueios.json`. **Histórico protegido:** se o `dados/historico.json` for trocado por uma cópia antiga (por exemplo, ao copiar o zip do app por cima com a pasta `dados`), o PUBLICAR devolve ao histórico as medições que continuam em `dados/medicoes/`.

**Node.js:** o cálculo usa o Node.js. Se o computador não tiver o Node.js 20.12 ou mais novo, o PUBLICAR baixa uma cópia na primeira vez (cerca de 30 MB, do site oficial nodejs.org, com conferência da assinatura) em `%LOCALAPPDATA%\DuplicidadeCadastro\node`. Não precisa de administrador. Se a rede da empresa bloquear o download, instale o Node.js LTS em https://nodejs.org e rode de novo.

### Opção B — pelo próprio site

1. No site, clique em **Atualizar base**, solte as planilhas e clique em **Processar**. O painel identifica cada planilha sozinho.
2. Confira a prévia e clique em **Salvar medição**. Ela fica guardada neste navegador.
3. Na janela **Enviar ao GitHub**, baixe o `historico.json` e o arquivo `s….json` da medição.
4. Dê dois cliques no **PUBLICAR.bat**: ele pega esses arquivos na pasta Downloads, junta com o que já está no repositório e publica. Também dá para enviar cada um pelo site do GitHub, em **Add file → Upload files → Commit changes** (`historico.json` em `dados/`, `s….json` em `dados/medicoes/`).
5. Em 1 a 2 minutos todo mundo vê a nova medição. No navegador de quem a gerou, a cópia guardada é apagada sozinha.

### Opção C — pelo site do GitHub (GitHub Actions)

1. No site do GitHub, abra a pasta `planilhas/` do repositório e envie as planilhas em **Add file → Upload files**.
2. O GitHub processa as planilhas e grava a medição em `dados/`. Acompanhe na aba **Actions**.
3. O site é publicado de novo e mostra o novo ponto na evolução.

Nesta opção as planilhas ficam guardadas no repositório, que é público no GitHub Pages gratuito. O upload pelo site do GitHub aceita arquivos de até **25 MB**.

## Instalar como aplicativo

Com o site publicado no GitHub Pages (endereço https), o painel pode ser instalado como um app:

- **Chrome ou Edge no computador:** clique em **Instalar app**, no topo do painel, ou no ícone de instalar no fim da barra de endereço. O app ganha atalho no menu Iniciar e, se você quiser, na área de trabalho, e abre numa janela própria.
- **Android (Chrome):** botão **Instalar app** ou menu ⋮ → **Instalar app** / **Adicionar à tela inicial**.
- **iPhone ou iPad (Safari):** botão **Instalar app** mostra o passo a passo: Compartilhar → **Adicionar à Tela de Início**.

O botão só aparece quando o navegador permite instalar e some depois que o app está instalado. O app instalado é o mesmo site: toda publicação nova aparece nele sozinha. Sem internet, ele abre com a última base que foi aberta naquele aparelho.

Para desinstalar: no app, menu ⋯ → **Desinstalar**. No celular, segure o ícone e remova.

## Marcar os bloqueios

Na tela **Bloquear**, cada linha tem a caixa **Bloqueei**. Marque depois de bloquear o produto no Protheus:

- a linha fica no lugar e vira **Bloqueado** (nada anda debaixo do mouse; o cursor vai para a próxima) e **Desfazer** aparece por alguns segundos. Ao trocar de página ou de filtro, os já marcados saem da lista;
- o topo da tela mostra quantos já foram bloqueados, quantos faltam e quantos hoje;
- **Já bloqueados** lista o que foi marcado, para conferir ou desmarcar;
- para manter o produto que a lista mandava bloquear, abra a linha e marque o outro (o sugerido para ficar) — a lista se ajusta;
- o Excel da lista traz o que bloquear, o que manter, o motivo, os avisos e se já foi marcado.

### Marcações para todos (GitHub conectado)

Para que cada marcação apareça para todo mundo que abre o site, quem marca conecta **uma vez** uma chave do GitHub no navegador dele:

1. O dono do repositório cria a chave em GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → **Generate new token** (https://github.com/settings/personal-access-tokens/new):
   - *Repository access*: **Only select repositories** → este repositório;
   - *Permissions → Repository permissions → Contents*: **Read and write**;
   - validade: a maior que a conta permitir; quando vencer, o site avisa e pede uma chave nova.
2. No site, tela **Bloquear** → **Salvar para todos** → cole a chave (começa com `github_pat_`) e o nome de quem marca → **Conectar**.

Depois disso — **sem precisar desconectar nunca**:

- cada marcação é salva para todos sozinha, uns 2 segundos depois do clique (em lote, se você marcar vários seguidos). O indicador mostra **Salvando para todos…** e depois **✓ Salvo para todos às hh:mm**;
- o botão **Salvar para todos** continua lá: clique se quiser forçar na hora — ele grava o que faltar e já busca o que os outros marcaram;
- quem está conectado vê as marcações dos outros em até 20 segundos (o site avisa "N bloqueios novos marcados em outros computadores"); quem não está conectado vê em 1 a 2 minutos (o tempo de o GitHub Pages publicar) e tem o botão **↻ Atualizar**;
- se duas pessoas marcarem ao mesmo tempo, o site junta as duas (por produto vale a alteração mais recente);
- a chave pode ser usada em mais de um computador (cada um com o nome de quem marca). Ela fica guardada só naquele navegador e só dá acesso a este repositório. Não conecte em computador compartilhado. Para tirar: botão **⚙ GitHub** → **Desconectar este navegador**.

Quem só consulta não precisa conectar nada. Sem chave, a marcação fica só no navegador (o topo avisa "N marcações só neste computador"); dá para mandar pelo jeito antigo: **Salvar para todos** → *baixar o bloqueios.json* → dois cliques no **PUBLICAR.bat**.

A marcação vale por empresa + código e continua nas próximas medições. Quando a SB1 nova chega com o produto inativo (Ativo = N), ele conta como **confirmado na base**. Se foi marcado antes da medição e ainda está ativo na SB1, aparece como **a conferir**.

## Publicar sem o VS Code (PUBLICAR.bat)

Dê dois cliques no **PUBLICAR.bat**, que fica na pasta principal do app, junto do `index.html`. Ele faz cinco coisas:

1. Busca o que já está no GitHub, por exemplo uma medição gravada pelo GitHub Actions.
2. Prepara o Node.js, que calcula a medição. Se não houver Node.js no computador, baixa uma cópia na primeira vez.
3. Processa as planilhas da pasta `planilhas/` e traz da pasta **Downloads** os arquivos baixados pelo site: o `historico.json` e o `bloqueios.json` são juntados com os de `dados/`, sem perder nada do repositório, e os `s….json` vão para `dados/medicoes/`. Medição que está em `dados/medicoes/` mas sumiu do histórico volta para ele.
4. Registra todas as alterações da pasta (commit).
5. Envia tudo, mostra se a base foi atualizada ou não (e por quê) e oferece abrir o site. O registro completo fica em `PUBLICAR-log.txt`.

Requisitos e primeiro uso:

- É preciso ter o **Git** instalado (https://git-scm.com/download/win).
- Na primeira vez pode abrir uma janela de login do GitHub.
- Se a pasta ainda não estiver ligada a um repositório, o PUBLICAR pede o endereço do repositório (crie-o vazio, sem README) e configura sozinho.

## Regras de cálculo

- **Produtos comparados:** os ativos da SB1, comparados só com os da mesma empresa. A empresa sai da filial: `02` ou `10`.
- **Inativos:** produtos com **Ativo = N** na SB1 (ou *Bloqueado* = Sim, se a coluna B1_MSBLQL vier na exportação) contam como bloqueados. Eles ficam fora da comparação; um aviso abaixo dos indicadores mostra quantos são e se algum ainda tem saldo, previsão de chegada ou ponto de pedido.
- **Similaridade:** compara a descrição B1_DESC sem acentos, pontuação, zeros à esquerda e ordem das palavras. O resultado vai de 0 a 100%.
- **Medidas, códigos, tamanhos e cores:** quando as duas descrições têm esses termos e eles são diferentes, a similaridade cai. Por exemplo, "BOTINA Nº37" × "Nº38" e "BAUXITA -2"" × "+2"" não contam como duplicidade.
- **Faixas:** 95–100% é provável duplicidade e 80–94% é alta semelhança. Abaixo de 80% o par não aparece.
- **Não bloquear:** o produto tem saldo diferente de zero ou previsão de chegada maior que zero (SB2), ou ponto de pedido maior que zero (SBZ), em **qualquer filial da empresa**. O bloqueio na SB1 vale para a empresa toda.
- **Podem ser bloqueados:** os demais produtos com similar. Se o similar está em uso, bloqueie este e mantenha o similar. Se o similar também está livre, escolha qual manter: o painel sugere o de compra mais recente ou, sem compra, o código mais antigo.
- **NCM:** vem da coluna *Pos.IPI/NCM* (B1_POSIPI) da SB1. Aparece no produto e em cada similar, entra na busca (com ou sem pontos), tem filtro próprio (NCM diferente do similar, NCM igual, sem NCM) e vai para o Excel (NCM, NCM do similar e se são iguais). NCM 0000.00.00 ou vazio conta como "sem NCM". A **descrição** de cada NCM vem da tabela de NCM do Protheus (exportação **mata010**: colunas TEC e Descrição), guardada em `dados/ncm.json`. Para atualizar a tabela, coloque o mata010 na pasta `planilhas` (sozinho ou junto das outras planilhas) e rode o PUBLICAR; ou carregue em **Atualizar base** no site e envie o `ncm.json` ao GitHub. Quando o produto e o similar mais parecido têm NCM diferente, a coluna *O que fazer* avisa para conferir qual está certo antes de bloquear: o código que fica leva o NCM dele.
- **Grupos:** o código do grupo aparece com o zero da frente (0102), como no Protheus, seguido da descrição: "Grupo 0102 – FILTROS". As empresas têm tabelas de grupos diferentes (o 0102 é FILTROS na 02 e SEMI REBOQUES na 10), por isso cada uma fica separada em `dados/grupos.json`. A empresa de cada tabela vem do nome do arquivo (02 ou 10) e é conferida com os grupos usados pelos produtos daquela empresa: a tabela certa tem todos (100%); se o nome disser 02 e os grupos forem da 10, nada é gravado e o PUBLICAR (ou a janela Atualizar base) avisa. O Excel ganha as colunas *Descrição do grupo* e *Grupo do similar*.
- **Empresas separadas:** a 02 e a 10 têm cada uma o seu cadastro. O mesmo código costuma existir nas duas com descrições diferentes, então a comparação, o saldo, a previsão e o ponto de pedido são sempre calculados dentro da mesma empresa. O painel mostra uma empresa por vez.

## Testar no computador

Abrir o `index.html` com dois cliques funciona para carregar planilhas, mas o navegador bloqueia a leitura da pasta `dados/`. Para ver o histórico, rode um servidor simples dentro da pasta:

```
python -m http.server 8000
```

Depois abra `http://localhost:8000`.

Navegadores suportados: Chrome, Edge ou Firefox atualizados.
