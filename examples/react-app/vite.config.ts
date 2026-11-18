import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {swarmwatch} from '@swarmwatch/vite-plugin';
export default defineConfig({plugins:[swarmwatch(),react()],server:{host:'127.0.0.1',port:5173,strictPort:true}});
