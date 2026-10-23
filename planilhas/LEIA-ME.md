# Planilhas do Protheus

Coloque aqui as exportações do Protheus — **SB1**, **SBZ** e **Saldo Físico (SB2)** de cada empresa (.xlsx ou .csv) — e dê dois cliques no **PUBLICAR.bat**.

Opcional: a **tabela de NCM** (exportação **mata010**) atualiza a descrição dos NCM. Ela pode vir junto das outras planilhas ou sozinha.

- O nome dos arquivos não importa: o PUBLICAR identifica cada planilha sozinho. Pode usar subpastas.
- Ele calcula a medição no computador, grava o resultado em `dados/` e publica no GitHub.
- Depois, as planilhas usadas vão para `processadas/<data>/`, para não serem processadas de novo.
- As planilhas **não são enviadas ao GitHub**; só o resultado.

No fim, a faixa da janela diz **BASE ATUALIZADA E PUBLICADA** ou **ATENÇÃO: A BASE NÃO FOI ATUALIZADA**, com o motivo — por exemplo, falta uma planilha, há duas do mesmo tipo para a mesma empresa, alguma está aberta no Excel ou está em .xls (salve como .xlsx). Nesse caso as planilhas ficam aqui; corrija e rode de novo. Tudo o que apareceu na janela fica em `PUBLICAR-log.txt`, na pasta do app.
