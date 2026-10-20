import { useStore } from './store';
import { Header } from './components/Header';
import { Login } from './components/Login';
import { Rail } from './components/Rail';
import { SearchPanel } from './components/SearchPanel';
import { Sidebar } from './components/Sidebar';
import { ConversationView } from './components/ConversationView';
import { ThreadPanel } from './components/ThreadPanel';

export function App() {
  const { state } = useStore();
  if (!state.me) return <Login />;
  const panel = state.search.open ? 'search' : state.threadParentId !== null ? 'thread' : null;
  return (
    <div className={`app ${panel ? 'has-panel' : ''} ${state.mobileList ? 'show-list' : 'show-conv'}`}>
      <Rail />
      <div className="shell">
        <Header />
        <div className="content">
          <Sidebar />
          <main className="main">
            <ConversationView />
          </main>
          {panel === 'search' && <SearchPanel />}
          {panel === 'thread' && <ThreadPanel />}
        </div>
      </div>
      {state.toast && (
        <div className="toast" role="alert">
          {state.toast}
        </div>
      )}
    </div>
  );
}
