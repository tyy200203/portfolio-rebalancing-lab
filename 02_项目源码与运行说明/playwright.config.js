import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests', testMatch:'ui.spec.js', workers:1, retries:0,
  reporter:'list', outputDir:'tmp/playwright-results',
  use:{baseURL:'http://127.0.0.1:3107', viewport:{width:1440,height:1050},
    channel:process.env.BROWSER_CHANNEL === 'chromium' ? undefined : 'msedge'},
  webServer:{command:'node src/server.js',url:'http://127.0.0.1:3107/api/portfolio',reuseExistingServer:false,
    env:{PORT:'3107',DB_PATH:`tmp/ui-${Date.now()}.sqlite`}}
});
