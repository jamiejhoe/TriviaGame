#!/bin/bash
# Run this ON your EC2 instance after copying the project files over.
# Works on Amazon Linux 2023. For Ubuntu, swap yum → apt-get and use the deb NodeSource URL.

set -e

echo "==> Installing Node.js 20..."
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

echo "==> Installing PM2..."
sudo npm install -g pm2

echo "==> Installing app dependencies..."
npm install

echo "==> Starting app with PM2 on port 3000..."
pm2 start server.js --name triviablast
pm2 save

# Generate a startup script so PM2 relaunches on reboot
pm2 startup systemd -u $USER --hp $HOME | tail -n 1 | sudo bash || true

echo ""
echo "✅ App is running. Test with:  curl http://localhost:3000"
echo "   Useful commands:"
echo "     pm2 logs triviablast    # tail logs"
echo "     pm2 restart triviablast # after code updates"
echo "     pm2 status              # check running processes"
