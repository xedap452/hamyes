const axios = require('axios');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const readline = require('readline');

class HamsterKombatGame {
    constructor() {
        this.BASE_URL = 'https://api.hamsterkombatgame.io';
        this.TIMEOUT = 10000;
        this.UPGRADE_CONDITION = 500000;
        this.authorizationList = this.readCSV('authorization.csv');
        this.proxyList = this.readCSV('proxy.csv');
    }

    log(msg) {
        console.log(`[*] ${msg}`);
    }

    readCSV(filename) {
        const csvData = fs.readFileSync(filename, 'utf8');
        return csvData.split('\n').map(line => line.trim()).filter(line => line !== '');
    }

    createAxiosInstance(proxy) {
        const proxyAgent = new HttpsProxyAgent(proxy);
        return axios.create({
            baseURL: this.BASE_URL,
            timeout: this.TIMEOUT,
            headers: {
                'Content-Type': 'application/json'
            },
            httpsAgent: proxyAgent
        });
    }

    async checkProxyIP(proxy) {
        try {
            const proxyAgent = new HttpsProxyAgent(proxy);
            const response = await axios.get('https://api.ipify.org?format=json', {
                httpsAgent: proxyAgent 
            });
            if (response.status === 200) {
                return response.data.ip;
            } else {
                return 'Unknown';
            }
        } catch (error) {
            this.log(`Error khi kiểm tra IP của proxy: ${error}`);
            return 'Error';
        }
    }

    async getBalanceCoins(dancay, authorization) {
        try {
            const response = await dancay.post('/clicker/sync', {}, {
                headers: {
                    'Authorization': `Bearer ${authorization}`
                }
            });

            if (response.status === 200) {
                return response.data.clickerUser.balanceCoins;
            } else {
                this.log(`Không lấy được thông tin balanceCoins. Status code: ${response.status}`);
                return null;
            }
        } catch (error) {
            this.log(`Error: ${error}`);
            return null;
        }
    }

    async buyUpgrades(dancay, authorization) {
        try {
            const upgradesResponse = await dancay.post('/clicker/upgrades-for-buy', {}, {
                headers: {
                    'Authorization': `Bearer ${authorization}`
                }
            });

            if (upgradesResponse.status === 200) {
                const upgrades = upgradesResponse.data.upgradesForBuy;
                let balanceCoins = await this.getBalanceCoins(dancay, authorization);
                let purchased = false;

                for (const upgrade of upgrades) {
                    if (upgrade.cooldownSeconds > 0) {
                        this.log(`Thẻ ${upgrade.name} đang trong thời gian cooldown ${upgrade.cooldownSeconds} giây.`);
                        continue; 
                    }

                    if (upgrade.isAvailable && !upgrade.isExpired && upgrade.price < this.UPGRADE_CONDITION && upgrade.price <= balanceCoins) {
                        const buyUpgradePayload = {
                            upgradeId: upgrade.id,
                            timestamp: Math.floor(Date.now() / 1000)
                        };
                        try {
                            const response = await dancay.post('/clicker/buy-upgrade', buyUpgradePayload, {
                                headers: {
                                    'Authorization': `Bearer ${authorization}`
                                }
                            });
                            if (response.status === 200) {
                                this.log(`(${Math.floor(balanceCoins)}) Đã nâng cấp thẻ ${upgrade.name}.`);
                                purchased = true;
                                balanceCoins -= upgrade.price; 
                            }
                        } catch (error) {
                            if (error.response && error.response.data && error.response.data.error_code === 'UPGRADE_COOLDOWN') {
                                this.log(`Thẻ ${upgrade.name} đang trong thời gian cooldown ${error.response.data.cooldownSeconds} giây.`);
                                continue; 
                            } else {
                                throw error;
                            }
                        }
                        await new Promise(resolve => setTimeout(resolve, 1000)); 
                    }
                }

                if (!purchased) {
                    this.log(`Token ${authorization.substring(0, 10)}... không có thẻ nào khả dụng hoặc đủ điều kiện. Chuyển token tiếp theo...`);
                    return false;
                }
            } else {
                this.log(`Không lấy được danh sách thẻ. Status code: ${upgradesResponse.status}`);
                return false;
            }
        } catch (error) {
            this.log('Lỗi không mong muốn, chuyển token tiếp theo');
            return false;
        }
        return true;
    }

    async claimDailyCipher(dancay, authorization, cipher) {
        if (cipher) {
            try {
                const payload = {
                    cipher: cipher
                };
                const response = await dancay.post('/clicker/claim-daily-cipher', payload, {
                    headers: {
                        'Authorization': `Bearer ${authorization}`
                    }
                });

                if (response.status === 200) {
                    this.log(`Đã giải mã morse ${cipher}`);
                } else {
                    this.log(`Không claim được daily cipher. Status code: ${response.status}`);
                }
            } catch (error) {
                this.log(`Error: ${error.message || error}`);
            }
        }
    }

    async runForAuthorization(authorization, proxy, cipher, no) {
        const ip = await this.checkProxyIP(proxy);
        console.log(`========== Tài khoản ${no + 1} | ip: ${ip} ==========`);
        const dancay = this.createAxiosInstance(proxy);

        await this.claimDailyCipher(dancay, authorization, cipher);
        await this.startAndClaimKeysMinigame(dancay, authorization);

        while (true) {
            const success = await this.buyUpgrades(dancay, authorization);
            if (!success) {
                break;
            }
        }
    }

    async startAndClaimKeysMinigame(dancay, authorization) {
        try {
            const startResponse = await dancay.post('/clicker/start-keys-minigame', {}, {
                headers: {
                    'Authorization': `Bearer ${authorization}`
                }
            });

            if (startResponse.status === 200) {
                this.log(`Đã bắt đầu keys minigame!`);
            } else {
                this.log(`Không thể bắt đầu keys minigame. Status code: ${startResponse.status}`);
                return;
            }

            await new Promise(resolve => setTimeout(resolve, 20000)); 

            const tokenSuffix = authorization.slice(-10);
            const randomPrefix = '0' + Math.floor(Math.random() * 1000000000).toString().padStart(9, '0');
            const cipher = `${randomPrefix}|${tokenSuffix}`;
            const base64Cipher = Buffer.from(cipher).toString('base64');

            const claimResponse = await dancay.post('/clicker/claim-daily-keys-minigame', { cipher: base64Cipher }, {
                headers: {
                    'Authorization': `Bearer ${authorization}`
                }
            });

            if (claimResponse.status === 200) {
                this.log(`Đã claim daily keys minigame!`);
            } else {
                this.log(`Không thể claim daily keys minigame. Status code: ${claimResponse.status}`);
            }
        } catch (error) {
            this.log(`Error: ${error.message || error}`);
        }
    }

    async askForUpgrade() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise(resolve => {
            rl.question('Có nâng cấp thẻ không? (y/n): ', (answer) => {
                rl.close();
                resolve(answer.trim().toLowerCase() === 'y');
            });
        });
    }

    async askForCipher() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise(resolve => {
            rl.question('Mã morse hôm nay cần giải: ', (answer) => {
                rl.close();
                resolve(answer.trim().toUpperCase());
            });
        });
    }

    async main() {
        const shouldUpgrade = await this.askForUpgrade(); 
        const cipher = await this.askForCipher();
    
        for (let i = 0; i < this.authorizationList.length; i++) {
            const authorization = this.authorizationList[i];
            const proxy = this.proxyList[i % this.proxyList.length];
    
            if (shouldUpgrade) { 
                await this.runForAuthorization(authorization, proxy, cipher, i);
            } else { 
                const ip = await this.checkProxyIP(proxy);
                console.log(`========== Tài khoản ${i + 1} | ip: ${ip} ==========`);
                const dancay = this.createAxiosInstance(proxy);
                await this.claimDailyCipher(dancay, authorization, cipher);
                await this.startAndClaimKeysMinigame(dancay, authorization);
            }
        }
        this.log('Đã chạy xong tất cả các token.');
    }
}

const game = new HamsterKombatGame();
game.main().catch(error => game.log(`Error in main: ${error}`));