import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import './index.css';
// KM-402：index.css 仅保留主题 token 与基础元素（≤20KB），
// 分区样式拆分到 styles/*.css 并按层叠顺序导入。
import './styles/memory-cards.css';
import './styles/integrations.css';
import './styles/tags-panels.css';
import './styles/valley-graph.css';
import './styles/widgets.css';
import './styles/agents-mailbox.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
