const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

class MLAuth {
    constructor(configPath) {
        this.configPath = configPath;
        this.config = fs.readJsonSync(configPath);
    }

    async getAccessToken() {
        return this.config.mercadolivre.access_token;
    }

    async refreshToken() {
        console.log("Renovando Access Token do Mercado Livre...");
        const url = "https://api.mercadolibre.com/oauth/token";
        const data = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: this.config.mercadolivre.client_id,
            client_secret: this.config.mercadolivre.client_secret,
            refresh_token: this.config.mercadolivre.refresh_token
        });

        try {
            const response = await axios.post(url, data.toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            const newData = response.data;
            this.config.mercadolivre.access_token = newData.access_token;
            this.config.mercadolivre.refresh_token = newData.refresh_token;

            // Salva de volta no config.json
            await fs.writeJson(this.configPath, this.config, { spaces: 4 });
            console.log("Token renovado com sucesso!");
            return newData.access_token;
        } catch (error) {
            console.error("Erro ao renovar token:", error.response ? error.response.data : error.message);
            throw error;
        }
    }

    getHeaders() {
        return {
            'Authorization': `Bearer ${this.config.mercadolivre.access_token}`,
            'Accept': 'application/json'
        };
    }
}

module.exports = MLAuth;
