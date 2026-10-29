import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@fontsource/black-han-sans/index.css';
import './styles/base.css';
import './styles/pages.css';
import './styles/screen.css';
import './styles/phone.css';
import './styles/games.css';
import './styles/orientation.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
