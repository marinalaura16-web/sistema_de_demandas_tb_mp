# 📋 Demandas

App para concentrar em um só lugar todas as demandas da Dra. Tallyta: **A fazer → Em andamento → Feito**.
Funciona no iPhone e no Android, instalado na tela inicial como um app.

- Prioridade **Alta / Média / Baixa**, e a lista já vem na ordem do que fazer primeiro
- Comentários e anexos (fotos, PDF, Word, Excel) em cada demanda
- Notificação no celular quando chega demanda nova, comentário, anexo ou conclusão
- Atualiza sozinho nos dois celulares, com busca e histórico do que foi feito

**Tecnologia:** app web instalável (PWA), sem custo, hospedado no GitHub Pages, com banco, login e arquivos no [Supabase](https://supabase.com) (plano gratuito).

```
app/                       ← o app (é o que vai para o ar)
  config.js                ← ✏️ onde entram as chaves do Supabase
  gerar-chaves.html        ← gera as chaves de notificação (uso único)
supabase/banco.sql         ← cria as tabelas e a segurança
supabase/functions/notificar/index.ts ← envia as notificações
```

---

## ⚙️ Configuração (uma vez só, pelo computador · ~20 minutos)

### 1. Criar o projeto no Supabase
1. Entre em **supabase.com** e clique em **New project**.
2. Dê um nome (ex.: `demandas`), crie uma senha do banco (guarde-a) e escolha a região **South America (São Paulo)**.
3. Espere uns 2 minutos até o projeto ficar pronto.

### 2. Criar as tabelas
1. No menu da esquerda, abra **SQL Editor** e clique em **New query**.
2. Abra o arquivo [`supabase/banco.sql`](supabase/banco.sql), copie **tudo**, cole e clique em **Run**.
3. Deve aparecer *"Success. No rows returned"*.

### 3. Criar os logins (só vocês duas)
1. Vá em **Authentication → Users → Add user → Create new user**.
2. Informe o e-mail e a senha da Dra. Tallyta, marque **Auto Confirm User** e clique em **Create user**.
3. Repita com o seu e-mail.
4. Vá em **Authentication → Sign In / Providers**, desligue **Allow new users to sign up** e salve.
   Assim ninguém mais consegue criar conta.

### 4. Colocar as chaves no app
1. Em **Project Settings → API** (ou **Data API / API Keys**), copie:
   - a **Project URL** (`https://xxxx.supabase.co`);
   - a chave **anon public**.
2. No GitHub, abra `app/config.js`, clique no lápis ✏️, cole os dois valores no lugar de `COLE_AQUI...` e clique em **Commit changes**.

### 5. Publicar o app (GitHub Pages)
1. No repositório do GitHub, vá em **Settings → Pages**.
2. Em **Source**, escolha **GitHub Actions**.
3. Vá na aba **Actions** e espere o "Publicar app" ficar verde ✅. Se ele não tiver rodado, clique em **Run workflow**.
4. O app fica em: **`https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`**

### 6. Ativar as notificações
1. Abra no computador **`https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/gerar-chaves.html`** e clique em **Gerar chaves**.
2. Copie a **chave pública** para `app/config.js`, no campo `VAPID_PUBLIC_KEY`, e salve (Commit).
3. No Supabase, vá em **Edge Functions → Secrets** e adicione três segredos:

   | Nome | Valor |
   |---|---|
   | `VAPID_PUBLIC_KEY` | a chave pública |
   | `VAPID_PRIVATE_KEY` | a chave privada (**nunca** coloque no GitHub) |
   | `VAPID_SUBJECT` | `mailto:seu-email@exemplo.com` |

4. Em **Edge Functions**, clique em **Deploy a new function → Via Editor**.
5. Dê o nome **`notificar`**, apague o código de exemplo, cole todo o conteúdo de [`supabase/functions/notificar/index.ts`](supabase/functions/notificar/index.ts) e clique em **Deploy**.

Pronto! ✅

---

## 📱 Instalar nos celulares

**iPhone (Dra. Tallyta)**, que precisa do iOS 16.4 ou mais novo para as notificações:
1. Abra o link do app no **Safari**. Tem que ser o Safari, não o Chrome.
2. Toque em **Compartilhar** (quadrado com seta ↑) e depois em **Adicionar à Tela de Início**.
3. Abra o app **pelo ícone** novo, faça o login e vá em ⚙️ **Ajustes → Ativar notificações** → **Permitir**.

**Android**
1. Abra o link no **Chrome**.
2. Toque em **Instalar**, no aviso que aparece no app, ou em ⋮ → **Instalar app**.
3. Abra pelo ícone, faça o login e vá em ⚙️ **Ajustes → Ativar notificações** → **Permitir**.

Em **Ajustes** cada uma também pode corrigir o próprio nome, que aparece nas demandas e nos comentários.

---

## Como usar
- **＋** cria uma demanda, com título, detalhes, prioridade e anexos.
- Toque numa demanda para mudar a **situação** (A fazer / Em andamento / Feito), mudar a prioridade, editar o texto, comentar ou anexar arquivos.
- A aba **Feito** guarda o histórico, com quem concluiu e quando.
- A busca procura no título e nos detalhes.

## Dúvidas comuns
- **Não chega notificação no iPhone:** confira se o app foi aberto pelo ícone da tela inicial e se as notificações estão permitidas em Ajustes do iPhone → Notificações → Demandas.
- **Quem cria ou comenta não recebe a notificação**, só a outra pessoa. Isso é proposital.
- **Limites do plano gratuito do Supabase:** 500 MB de banco e 1 GB de arquivos, muito mais do que o necessário. Projetos gratuitos sem nenhum acesso por 7 dias são pausados, mas com uso diário isso não acontece.
