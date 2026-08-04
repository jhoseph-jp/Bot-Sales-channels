# Setup do WhatsApp (Baileys)

Guia para ativar o envio de ofertas/cupons num grupo do WhatsApp, rodando o bot local.

> ⚠️ O bot usa uma conta de WhatsApp **própria** (não o seu número pessoal).
> Automatizar o WhatsApp pode levar a ban do número — por isso use um **chip dedicado**.
> Assim, se algo der errado, seu número pessoal continua intacto.

---

## 1. Conseguir o número do bot

- Compre um **chip pré-pago barato** (R$10–15) OU ative um **eSIM** pré-pago
  (o iPhone 17 Pro Max tem dual-SIM, então dá pra ter os dois no mesmo aparelho).
- Mantenha esse chip ativo (recarga esporádica no pré-pago) pra não perder o número.

## 2. Registrar a conta do bot no iPhone

- Instale o app **WhatsApp Business** (é separado do WhatsApp normal — os dois
  convivem no mesmo iPhone).
- Registre o **WhatsApp Business com o número do chip novo**.
- Resultado: dois apps no iPhone → WhatsApp (pessoal, intacto) + WhatsApp Business (bot).

## 3. Criar o grupo

- No **WhatsApp Business** (conta do bot), crie o grupo (ex.: "Ofertas Delas").
- Adicione seu **número pessoal** ao grupo (pra você também receber as ofertas).
- Recomendado: nas configs do grupo, deixe **"Só admins podem enviar mensagens"**
  (vira tipo um canal) — e mantenha o número do bot como **admin**.

## 4. Parear o bot (Baileys) — 1x

No terminal do PC, na pasta do projeto:

```bash
npm run wa-login
```

- Vai aparecer um **QR Code** no terminal.
- No **WhatsApp Business** → **Configurações → Aparelhos conectados →
  Conectar um aparelho** → escaneie o QR.
- Após conectar, o script **lista os grupos com o JID** de cada um, ex.:

  ```
  📛 Ofertas Delas
     JID: 120363XXXXXXXXXXXX@g.us
  ```

- A sessão fica salva em `data/whatsapp_auth/` (não precisa reescanear depois).

## 5. Configurar e ligar

- Copie o JID do grupo para o `.env`:

  ```
  WHATSAPP_GROUP_ID=120363XXXXXXXXXXXX@g.us
  ```

- Inicie o bot:

  ```bash
  npm start
  ```

Pronto. Toda oferta/cupom que vai pro Telegram vai também pro grupo do WhatsApp.

---

## Manutenção / dicas

- O Baileys entra como **"aparelho conectado"** (igual WhatsApp Web). O WhatsApp
  permite até 4 aparelhos linkados.
- O iPhone com o WhatsApp Business é o "aparelho principal" — como fica sempre
  com você, a conexão não cai. Abra o Business de vez em quando.
- Se a sessão cair / número deslogar: rode `npm run wa-login` de novo.
- **PC precisa ficar ligado e com internet** pro bot postar (vale pra Telegram,
  Instagram e WhatsApp).
- Para desativar o WhatsApp temporariamente: deixe `WHATSAPP_GROUP_ID=` vazio no `.env`.

## Comandos úteis

| Comando | O que faz |
|---|---|
| `npm run wa-login` | Parear a conta do bot + listar grupos/JIDs |
| `npm start` | Rodar o bot (Telegram + Instagram + WhatsApp) |
