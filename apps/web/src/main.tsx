import { createRoot } from 'react-dom/client';
import 'antd/dist/reset.css';
import '@xyflow/react/dist/style.css';
import { App } from '@/app/App';
import './styles.css';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

dayjs.locale('zh-cn');
const root = document.getElementById('root');

if (!root) {
  throw new Error('未找到 #root 挂载点');
}

createRoot(root).render(<App />);
