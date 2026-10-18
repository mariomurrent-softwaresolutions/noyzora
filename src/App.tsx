import Monitor from './pages/Monitor'
import Visualizer from './pages/Visualizer'
import { usePath } from './router'

export default function App() {
  const path = usePath()
  if (path === '/visualizer') return <Visualizer />
  return <Monitor />
}
