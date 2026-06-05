# TriviaBlast

Kahoot-style multiplayer trivia game. Host on one screen, players join from their phones.

## Local run

```bash
npm install
node server.js
```

Open `http://localhost:3000` for the host view.

## Deploying to EC2 (key-less flow)

This flow assumes you're using a key-less shell method like **SSM Session Manager** or your org's equivalent — no SSH key pair required.

You'll need:
- An EC2 instance (Amazon Linux 2023, t3.micro is plenty for small groups)
- The instance's public IPv4 address (or an Elastic IP)
- A Security Group rule opening inbound TCP **3000** from `0.0.0.0/0`
- A shell session on the instance (via SSM / your internal access tool)

### 1. Get the project files onto the instance

Pick whichever of these works in your environment:

**Option A — Git (cleanest if your code is in a repo):**
```bash
sudo yum install -y git
git clone <your-repo-url>
cd trivia-app
```

**Option B — S3 (good for corporate setups):**
Upload the `trivia-app/` folder to an S3 bucket from your laptop, then on the instance:
```bash
aws s3 cp s3://<your-bucket>/trivia-app/ ./trivia-app/ --recursive
cd trivia-app
```

**Option C — Paste inline (works for a quick test):**
On the instance, create the files by pasting content directly. Fine for a one-off, tedious for real use.

### 2. Run the deploy script

```bash
chmod +x deploy.sh
./deploy.sh
```

Installs Node 20, PM2, dependencies, and starts the server.
##
Make sure you open port 3000 to public traffic on security group first

### 3. Restart with your public hostname

The QR code needs to encode an address your players can reach:

```bash
pm2 delete triviablast
PUBLIC_HOST=<ec2-public-ip>:3000 pm2 start server.js --name triviablast
pm2 save
```

### 4. Test

- Host: open `http://<ec2-public-ip>:3000` in your browser
- Players: scan the QR, or visit `http://<ec2-public-ip>:3000/player.html`

Sanity check from your Mac:
```bash
curl -I http://<ec2-public-ip>:3000
```
`HTTP/1.1 200 OK` means you're live.

## Useful PM2 commands

```bash
pm2 logs triviablast    # tail logs
pm2 restart triviablast # after code updates
pm2 status              # running processes
```

## Updating the app later

Same file-transfer method as step 1 (git pull, S3 sync, etc.), then:
```bash
cd trivia-app
npm install   # only if dependencies changed
pm2 restart triviablast
```

## HTTPS (optional)

iOS Safari behaves best over HTTPS and secure WebSockets (`wss://`) are ideal for production. Point a domain at the instance, then run [Caddy](https://caddyserver.com/) as a reverse proxy — it grabs a Let's Encrypt cert automatically:

```
your-domain.com {
    reverse_proxy localhost:3000
}
```

Open 80 and 443 in the Security Group instead of 3000.
