# Planilhas do Protheus

Coloque aqui as exportações do Protheus — **SB1**, **SBZ** e **Saldo Físico (SB2)** de cada empresa (.xlsx ou .csv) — e dê dois cliques no **PUBLICAR.bat**.

Opcional: a **tabela de NCM** (exportação **mata010**) atualiza a descrição dos NCM. Ela pode vir junto das outras planilhas ou sozinha.

- O nome dos arquivos não importa: o PUBLICAR identifica cada planilha sozinho.
- Ele calcula a medição no computador, grava o resultado em `dados/` e publica no GitHub.
- Depois, as planilhas usadas vão para `processadas/<data>/`, para não serem processadas de novo.
- As planilhas **não são enviadas ao GitHub**; só o resultado.

Se faltar alguma planilha, se houver duas do mesmo tipo para a mesma empresa ou se alguma estiver aberta no Excel, o PUBLICAR avisa e não publica nada.
