import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import { setupThemeSync } from './services/beekeeper';

setupThemeSync();

const app = createApp(App);
app.mount('#app');
