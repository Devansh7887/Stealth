import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { 
  Menu, Search, Settings, PlusCircle, FileText, 
  ChevronRight, ChevronDown, Plus, MessageSquare, MoreHorizontal, Cloud, RefreshCw
} from 'lucide-react';

const backendUrl = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000').trim();

// Connect silently in the background as soon as the app opens
const socket = io(backendUrl, { autoConnect: true });

const DEFAULT_FILE_SYSTEM = [
  {
    id: 'folder-1',
    name: 'DSA Prep',
    isOpen: true,
    files: [
      { id: 'file-1', title: 'Arrays & Hashing', content: '## Arrays & Hashing\n\nRemember to check for edge cases when traversing.\n\n### Two Sum Solution\n\nUse a Hash Map to store the target complement.\n' },
      { id: 'file-2', title: 'Two Pointers', content: '## Two Pointers\n\nGreat for sorted arrays.\n' }
    ]
  },
  {
    id: 'folder-2',
    name: 'System Design',
    isOpen: true,
    files: [
      { id: 'file-3', title: 'Load Balancing', content: 'Notes on load balancing strategies...' }
    ]
  }
];

const FILE_SYSTEM_STORAGE_KEY = 'stealth-file-system';
const FILE_SYSTEM_STORAGE_BACKUP_KEY = 'stealth-file-system-backup';
const CHAT_MESSAGES_STORAGE_KEY = 'stealth-chat-messages';
const CHAT_DRAFT_STORAGE_KEY = 'stealth-chat-draft';

export default function App() {
  const displayNameRef = useRef('');
  const clientIdRef = useRef(`client-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const noteTextareaRef = useRef(null);
  const chatInputRef = useRef(null);

  if (!displayNameRef.current) {
    try {
      const storedName = localStorage.getItem('stealth-display-name');
      if (storedName) {
        displayNameRef.current = storedName;
      } else {
        const generatedName = `User-${Math.floor(1000 + Math.random() * 9000)}`;
        localStorage.setItem('stealth-display-name', generatedName);
        displayNameRef.current = generatedName;
      }
    } catch {
      displayNameRef.current = `User-${Math.floor(1000 + Math.random() * 9000)}`;
    }
  }

  // --- FILE SYSTEM STATE ---
  const [fileSystem, setFileSystem] = useState(() => {
    try {
      const raw = localStorage.getItem(FILE_SYSTEM_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }

      const backupRaw = localStorage.getItem(FILE_SYSTEM_STORAGE_BACKUP_KEY);
      if (!backupRaw) return DEFAULT_FILE_SYSTEM;

      const backupParsed = JSON.parse(backupRaw);
      return Array.isArray(backupParsed) ? backupParsed : DEFAULT_FILE_SYSTEM;
    } catch {
      return DEFAULT_FILE_SYSTEM;
    }
  });

  const [activeFileId, setActiveFileId] = useState('file-1');
  const [activeView, setActiveView] = useState('notes'); // 'notes' | 'chat'
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isMobileView, setIsMobileView] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const [cursorInfo, setCursorInfo] = useState({ line: 1, column: 1 });
  const [cursorMap, setCursorMap] = useState({});
  
  // Search & Edit States
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  // --- CHAT STATE ---
  const [messages, setMessages] = useState(() => {
    try {
      const raw = localStorage.getItem(CHAT_MESSAGES_STORAGE_KEY);
      if (!raw) return [];

      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [currentMessage, setCurrentMessage] = useState(() => {
    try {
      return localStorage.getItem(CHAT_DRAFT_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [isConnected, setIsConnected] = useState(true); // Default true due to autoConnect
  const [unreadCount, setUnreadCount] = useState(0);
  
  const messagesEndRef = useRef(null);
  const activeViewRef = useRef(activeView); 
  const [chatCursorInfo, setChatCursorInfo] = useState({ line: 1, column: 1, position: 0 });

  const getCursorInfo = (text, cursorPos) => {
    const safeText = text || '';
    const safePos = Math.max(0, Math.min(cursorPos || 0, safeText.length));
    const beforeCursor = safeText.slice(0, safePos);
    const lines = beforeCursor.split('\n');
    return {
      line: lines.length,
      column: (lines[lines.length - 1] || '').length + 1
    };
  };

  const saveCursorState = (textareaEl) => {
    if (!activeFileId || !textareaEl) return;

    const selectionStart = textareaEl.selectionStart || 0;
    const scrollTop = textareaEl.scrollTop || 0;
    const nextCursorInfo = getCursorInfo(textareaEl.value, selectionStart);
    setCursorInfo(nextCursorInfo);

    setCursorMap((prev) => ({
      ...prev,
      [activeFileId]: {
        selectionStart,
        scrollTop
      }
    }));
  };

  const saveChatCursorState = (inputEl) => {
    if (!inputEl) return;

    const selectionStart = inputEl.selectionStart || 0;
    const nextCursorInfo = getCursorInfo(inputEl.value, selectionStart);
    setChatCursorInfo({
      line: nextCursorInfo.line,
      column: nextCursorInfo.column,
      position: selectionStart
    });
  };

  // Keep ref updated for the socket listener to know if chat is hidden
  useEffect(() => {
    activeViewRef.current = activeView;
    if (activeView === 'chat') {
      setUnreadCount(0); // Clear unread count when opening chat
    }
  }, [activeView]);

  // --- HELPER: GET ACTIVE FILE DATA ---
  let activeFile = null;
  let activeFolderName = '';
  fileSystem.forEach(folder => {
    const file = folder.files.find(f => f.id === activeFileId);
    if (file) {
      activeFile = file;
      activeFolderName = folder.name;
    }
  });

  // --- FILE SYSTEM LOGIC ---
  const handleCreateFolder = () => {
    const newFolder = {
      id: `folder-${Date.now()}`,
      name: 'New Workspace',
      isOpen: true,
      files: []
    };
    setFileSystem([...fileSystem, newFolder]);
    startEditing(newFolder.id, newFolder.name);
  };

  const handleCreateFile = (folderId, e) => {
    e.stopPropagation();
    const newFile = {
      id: `file-${Date.now()}`,
      title: 'Untitled',
      content: ''
    };
    setFileSystem(prev => prev.map(folder => {
      if (folder.id === folderId) {
        return { ...folder, isOpen: true, files: [...folder.files, newFile] };
      }
      return folder;
    }));
    setActiveFileId(newFile.id);
    setActiveView('notes');
    startEditing(newFile.id, newFile.title);
  };

  const toggleFolder = (folderId) => {
    setFileSystem(prev => prev.map(folder => 
      folder.id === folderId ? { ...folder, isOpen: !folder.isOpen } : folder
    ));
  };

  const selectFile = (fileId) => {
    setActiveFileId(fileId);
    setActiveView('notes');
  };

  const updateActiveFileContent = (newContent) => {
    setFileSystem(prev => prev.map(folder => ({
      ...folder,
      files: folder.files.map(f => f.id === activeFileId ? { ...f, content: newContent } : f)
    })));
  };

  // --- RENAMING LOGIC ---
  const startEditing = (id, currentName) => {
    setEditingId(id);
    setEditName(currentName);
  };

  const saveEditing = () => {
    if (editingId) {
      setFileSystem(prev => prev.map(folder => {
        if (folder.id === editingId) return { ...folder, name: editName || 'Untitled' };
        return {
          ...folder,
          files: folder.files.map(f => f.id === editingId ? { ...f, title: editName || 'Untitled' } : f)
        };
      }));
    }
    setEditingId(null);
  };

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter') saveEditing();
    if (e.key === 'Escape') setEditingId(null);
  };

  // --- SEARCH LOGIC ---
  const filteredFileSystem = fileSystem.map(folder => {
    if (!searchQuery) return folder;
    
    const query = searchQuery.toLowerCase();
    const matchedFiles = folder.files.filter(f => f.title.toLowerCase().includes(query));
    const folderMatches = folder.name.toLowerCase().includes(query);
    
    if (!folderMatches && matchedFiles.length === 0) return null;
    
    return {
      ...folder,
      isOpen: true, 
      files: folderMatches ? folder.files : matchedFiles
    };
  }).filter(Boolean);

  // --- THE SECRET TRIGGER LOGIC ---
  const handleContentChange = (e) => {
    const text = e.target.value;
    updateActiveFileContent(text);
    saveCursorState(e.target);

    // Trigger Regex: ``` \n connect-p2p 17
    const triggerRegex = /```[a-zA-Z]*\n?connect-p2p 17/;

    if (triggerRegex.test(text)) {
      updateActiveFileContent(text.replace(triggerRegex, '```\n'));
      setActiveView('chat');
      if (!isConnected) {
        socket.connect();
        setIsConnected(true);
      }
    }
  };

  // --- BACKGROUND CHAT LISTENER ---
  useEffect(() => {
    const handleReceive = (data) => {
      // Prevent duplicated own messages when backend echoes to sender.
      if (data?.clientId === clientIdRef.current) return;

      setMessages((prev) => [...prev, data]);
      
      // If we receive a message but are in the Notes view, increment unread counter
      if (activeViewRef.current !== 'chat') {
        setUnreadCount(prev => prev + 1);
      }
    };

    socket.on('receive_message', handleReceive);
    
    return () => {
      socket.off('receive_message', handleReceive);
    };
  }, []);

  useEffect(() => {
    if (activeView === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeView]);

  useEffect(() => {
    try {
      localStorage.setItem(FILE_SYSTEM_STORAGE_KEY, JSON.stringify(fileSystem));
      localStorage.setItem(FILE_SYSTEM_STORAGE_BACKUP_KEY, JSON.stringify(fileSystem));
    } catch {
      // Ignore localStorage failures.
    }
  }, [fileSystem]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_MESSAGES_STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Ignore localStorage failures.
    }
  }, [messages]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_DRAFT_STORAGE_KEY, currentMessage);
    } catch {
      // Ignore localStorage failures.
    }
  }, [currentMessage]);

  useEffect(() => {
    const fileExists = fileSystem.some((folder) => folder.files.some((file) => file.id === activeFileId));
    if (fileExists) return;

    const fallbackFileId = fileSystem[0]?.files[0]?.id;
    if (fallbackFileId) {
      setActiveFileId(fallbackFileId);
    }
  }, [fileSystem, activeFileId]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (currentMessage.trim() !== '') {
      const messageData = {
        id: Date.now(),
        clientId: clientIdRef.current,
        author: displayNameRef.current,
        text: currentMessage,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      socket.emit('send_message', messageData);
      setMessages((prev) => [...prev, messageData]);
      setCurrentMessage('');
    }
  };

  // --- BOSS KEY (HIDE CHAT) ---
  const hideChat = () => {
    setActiveView('notes');
    // We intentionally DO NOT socket.disconnect() here so we keep receiving messages!
  };

  const hardDisconnect = () => {
    socket.disconnect();
    setIsConnected(false);
    setActiveView('notes');
    setUnreadCount(0);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && activeView === 'chat') {
        hideChat();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeView]);

  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMouseMove = (e) => {
      const nextWidth = Math.min(420, Math.max(220, e.clientX));
      setSidebarWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobileView(window.innerWidth < 768);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    try {
      const rawState = localStorage.getItem('stealth-editor-ui-state');
      if (!rawState) return;

      const parsedState = JSON.parse(rawState);
      if (typeof parsedState.sidebarOpen === 'boolean') {
        setSidebarOpen(parsedState.sidebarOpen);
      }

      if (typeof parsedState.sidebarWidth === 'number') {
        const clampedWidth = Math.min(420, Math.max(220, parsedState.sidebarWidth));
        setSidebarWidth(clampedWidth);
      }

      if (parsedState.cursorMap && typeof parsedState.cursorMap === 'object') {
        setCursorMap(parsedState.cursorMap);
      }

      if (typeof parsedState.activeFileId === 'string') {
        setActiveFileId(parsedState.activeFileId);
      }
    } catch {
      // Ignore corrupted local state and continue with defaults.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        'stealth-editor-ui-state',
        JSON.stringify({
          sidebarOpen,
          sidebarWidth,
          cursorMap,
          activeFileId
        })
      );
    } catch {
      // Ignore localStorage failures.
    }
  }, [sidebarOpen, sidebarWidth, cursorMap, activeFileId]);

  useEffect(() => {
    if (activeView !== 'notes') return;

    const textarea = noteTextareaRef.current;
    if (!textarea) return;

    const savedCursor = cursorMap[activeFileId];
    const text = activeFile?.content || '';
    const restoredPos = Math.min(savedCursor?.selectionStart || 0, text.length);

    requestAnimationFrame(() => {
      textarea.scrollTop = savedCursor?.scrollTop || 0;
      textarea.setSelectionRange(restoredPos, restoredPos);
      setCursorInfo(getCursorInfo(text, restoredPos));
    });
  }, [activeFileId, activeView]);

  useEffect(() => {
    if (activeView !== 'chat') return;
    if (!chatInputRef.current) return;

    const input = chatInputRef.current;
    const restoredPos = Math.min(chatCursorInfo.position || 0, (currentMessage || '').length);

    requestAnimationFrame(() => {
      input.setSelectionRange(restoredPos, restoredPos);
      const next = getCursorInfo(currentMessage || '', restoredPos);
      setChatCursorInfo((prev) => ({
        ...prev,
        line: next.line,
        column: next.column,
        position: restoredPos
      }));
    });
  }, [activeView]);

  // --- UI RENDER ---
  return (
    <div className="flex h-[100dvh] w-full bg-white text-[#37352f] font-sans overflow-hidden selection:bg-blue-200">
      
      {/* --- NOTION SIDEBAR --- */}
      <aside className={`
        ${sidebarOpen ? 'translate-x-0 border-r border-[#ececeb]' : '-translate-x-full md:translate-x-0 border-r-0'} 
        transition-all duration-300 ease-in-out fixed md:relative z-20
        h-full bg-[#fbfbfa] flex flex-col flex-shrink-0 overflow-hidden
      `}
      style={{ width: sidebarOpen ? (isMobileView ? '82vw' : `${sidebarWidth}px`) : '0px' }}>
        {/* Workspace Selector */}
        <div className="flex items-center gap-2 p-3 hover:bg-[#efefed] cursor-pointer transition-colors m-1 rounded-md">
          <div className="w-5 h-5 bg-blue-600 rounded-sm flex items-center justify-center text-white text-xs font-bold shadow-sm">
            M
          </div>
          <span className="font-semibold text-sm truncate">MERN Workspace</span>
          <ChevronDown size={14} className="ml-auto text-gray-400" />
        </div>

        {/* Action Buttons & Search */}
        <div className="px-2 pb-4 pt-1 border-b border-[#ececeb]">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#efefed] rounded-md text-sm text-gray-600 focus-within:ring-1 focus-within:ring-blue-400 transition-all">
            <Search size={16} className="text-gray-400" /> 
            <input 
              type="text" 
              placeholder="Search..." 
              className="bg-transparent border-none outline-none w-full text-sm placeholder-gray-400"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div 
            onClick={handleCreateFolder}
            className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#efefed] rounded-md cursor-pointer text-sm text-gray-600 font-medium mt-2"
          >
            <PlusCircle size={16} className="text-gray-400" /> New Workspace
          </div>
        </div>

        {/* Page Tree (Dynamic File System) */}
        <div className="flex-1 overflow-y-auto py-3 px-2 custom-scrollbar">
          <div className="px-3 py-1 text-xs font-bold text-gray-400 mb-1">Private</div>
          
          <div className="flex flex-col gap-0.5">
            {filteredFileSystem.map((folder) => (
              <div key={folder.id} className="flex flex-col">
                <div 
                  className="flex items-center justify-between px-2 py-1 hover:bg-[#efefed] rounded-md cursor-pointer group"
                  onClick={() => toggleFolder(folder.id)}
                  onDoubleClick={() => startEditing(folder.id, folder.name)}
                >
                  <div className="flex items-center gap-1.5 overflow-hidden flex-1">
                    {folder.isOpen ? (
                      <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />
                    ) : (
                      <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
                    )}
                    
                    {editingId === folder.id ? (
                      <input 
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={saveEditing}
                        onKeyDown={handleEditKeyDown}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-white border border-blue-400 rounded px-1 text-sm w-full outline-none"
                      />
                    ) : (
                      <span className="text-sm font-medium truncate select-none">{folder.name}</span>
                    )}
                  </div>
                  <button 
                    onClick={(e) => handleCreateFile(folder.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-300 rounded transition-opacity"
                  >
                    <Plus size={14} className="text-gray-500" />
                  </button>
                </div>
                
                {/* Folder Files */}
                {folder.isOpen && (
                  <div className="pl-6 flex flex-col gap-0.5 mt-0.5">
                    {folder.files.map((file) => (
                      <div 
                        key={file.id}
                        onClick={() => selectFile(file.id)}
                        onDoubleClick={() => startEditing(file.id, file.title)}
                        className={`flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer text-sm transition-colors ${
                          activeFileId === file.id && activeView === 'notes' 
                            ? 'bg-[#efefed] text-black font-medium' 
                            : 'text-gray-600 hover:bg-[#efefed]'
                        }`}
                      >
                        <FileText size={14} className={activeFileId === file.id && activeView === 'notes' ? "text-gray-500" : "text-gray-400"} /> 
                        
                        {editingId === file.id ? (
                          <input 
                            autoFocus
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onBlur={saveEditing}
                            onKeyDown={handleEditKeyDown}
                            className="bg-white border border-blue-400 rounded px-1 text-sm w-full outline-none"
                          />
                        ) : (
                          <span className="truncate select-none">{file.title || 'Untitled'}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </aside>

      {sidebarOpen && isMobileView && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/10 z-10 md:hidden"
        />
      )}

      {sidebarOpen && (
        <div
          onMouseDown={() => setIsResizingSidebar(true)}
          className="hidden md:block w-1 cursor-col-resize bg-transparent hover:bg-gray-200 transition-colors"
          title="Drag to resize sidebar"
        />
      )}

      {/* --- MAIN AREA (EDITOR OR SECURE CHAT) --- */}
      <main className="flex-1 flex flex-col h-full bg-white relative w-full">
        {/* Top Bar / Breadcrumbs */}
        <div className="h-12 flex items-center justify-between px-4 text-sm text-gray-500 w-full border-b border-transparent shrink-0">
          
          <div className="flex items-center gap-2 overflow-hidden">
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1 hover:bg-gray-100 rounded-md"
            >
              <Menu size={18} />
            </button>
            <span className="truncate">{activeFolderName}</span>
            <span className="text-gray-300">/</span>
            <span className="truncate text-gray-700">{activeFile?.title || 'Untitled'}</span>
          </div>
          
          <div className="flex items-center gap-3">
            {/* STEALTH STATUS INDICATOR */}
            {isConnected && (
              <div 
                onClick={() => activeView === 'chat' ? hideChat() : setActiveView('chat')}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
                  unreadCount > 0 
                    ? 'bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium' 
                    : 'text-gray-400 hover:bg-gray-50'
                }`}
                title={activeView === 'chat' ? "Hide Comments" : "Open Comments"}
              >
                {unreadCount > 0 ? (
                  <>
                    <RefreshCw size={12} className="animate-spin text-blue-500" />
                    <span>Syncing ({unreadCount} pending)</span>
                  </>
                ) : (
                  <>
                    <Cloud size={14} className="text-gray-300" />
                    <span className="hidden sm:inline">Synced</span>
                  </>
                )}
              </div>
            )}

            {activeView === 'notes' && (
              <span className="text-xs text-gray-400 hidden sm:block">
                Ln {cursorInfo.line}, Col {cursorInfo.column}
              </span>
            )}

            {activeView === 'chat' && (
              <span className="text-xs text-gray-400 hidden sm:block">
                Ln {chatCursorInfo.line}, Col {chatCursorInfo.column}
              </span>
            )}
            
            <span className="text-xs text-gray-400 hidden sm:block">Edited just now</span>
            <MoreHorizontal size={18} className="text-gray-400 cursor-pointer hover:text-gray-600" />
          </div>
        </div>

        {/* --- DYNAMIC VIEW PORTION --- */}
        {/* Using CSS 'hidden' instead of unmounting so state is preserved! */}
        
        {/* NOTION EDITOR VIEW */}
        <div className={`flex-1 overflow-y-auto p-6 md:p-12 lg:px-24 ${activeView === 'notes' ? 'block' : 'hidden'}`}>
          <div className="max-w-3xl mx-auto flex flex-col h-full">
            {editingId === activeFile?.id ? (
               <input 
               value={editName}
               onChange={(e) => setEditName(e.target.value)}
               onBlur={saveEditing}
               onKeyDown={handleEditKeyDown}
               className="text-4xl font-bold mb-6 outline-none bg-transparent placeholder-gray-200 w-full border-b border-blue-200"
               autoFocus
             />
            ) : (
              <div 
                onDoubleClick={() => startEditing(activeFile?.id, activeFile?.title)}
                className="text-4xl font-bold mb-6 text-[#37352f] min-h-[40px] cursor-text"
              >
                {activeFile?.title || 'Untitled'}
              </div>
            )}
            
            <textarea
              ref={noteTextareaRef}
              className="flex-1 w-full bg-transparent outline-none resize-none font-sans text-base text-[#37352f] leading-relaxed placeholder-gray-300"
              value={activeFile?.content || ''}
              onChange={handleContentChange}
              onClick={(e) => saveCursorState(e.target)}
              onKeyUp={(e) => saveCursorState(e.target)}
              onSelect={(e) => saveCursorState(e.target)}
              onScroll={(e) => saveCursorState(e.target)}
              placeholder="Press '/' for commands, or write your notes... (Hint: try writing a code block)"
              spellCheck="false"
            />
          </div>
        </div>

        {/* STEALTH CHAT VIEW - Looks like Notion Comments */}
        <div className={`flex-1 flex-col w-full max-w-3xl mx-auto h-full px-6 md:px-12 lg:px-24 pb-6 animate-in fade-in duration-300 ${activeView === 'chat' ? 'flex' : 'hidden'}`}>
          
          <div className="flex justify-between items-end border-b border-gray-100 pb-4 pt-6 mb-6">
             <div className="text-4xl font-bold text-gray-800">
               {activeFile?.title || 'Untitled'}
             </div>
             <span className="text-xs text-gray-400 font-medium">Collaborator Mode</span>
          </div>
          
          {/* Chat Messages Feed */}
          <div className="flex-1 overflow-y-auto flex flex-col gap-0 py-4 pr-2">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-32 text-gray-400 space-y-2">
                <MessageSquare size={24} className="text-gray-300" />
                <p className="text-sm">No comments yet. Start the discussion.</p>
              </div>
            )}
            
            {messages.map((msg, idx) => {
              const senderKey = msg.clientId || msg.author || 'unknown';
              const prevSenderKey = idx > 0 ? (messages[idx - 1].clientId || messages[idx - 1].author || 'unknown') : null;
              const spacingClass = idx === 0 ? 'mt-0' : prevSenderKey === senderKey ? 'mt-3' : 'mt-10';

              return (
              <div key={idx} className={`w-full ${spacingClass}`}>
                <div className="px-1 py-0.5 text-[15px] leading-relaxed text-[#37352f]">
                  {msg.text}
                </div>
              </div>
            )})}
            <div ref={messagesEndRef} className="h-4" />
          </div>

          {/* Notion-style Input Box */}
          <div className="mt-4 pt-4 bg-white">
            <form onSubmit={sendMessage} className="relative flex items-center">
              <div className="absolute left-3 text-gray-400">
                <PlusCircle size={18} />
              </div>
              <input
                ref={chatInputRef}
                type="text"
                dir="ltr"
                style={{ textAlign: 'left', unicodeBidi: 'plaintext' }}
                className="w-full bg-[#fbfbfa] border border-[#ececeb] rounded-lg pl-10 pr-12 py-3 text-[15px] text-[#37352f] placeholder-gray-400 outline-none focus:bg-white focus:border-gray-300 focus:shadow-sm transition-all"
                placeholder="Add a comment..."
                value={currentMessage}
                onChange={(e) => {
                  setCurrentMessage(e.target.value);
                  saveChatCursorState(e.target);
                }}
                onClick={(e) => saveChatCursorState(e.target)}
                onKeyUp={(e) => saveChatCursorState(e.target)}
                onSelect={(e) => saveChatCursorState(e.target)}
              />
              <button 
                type="submit" 
                disabled={!currentMessage.trim()}
                className={`absolute right-3 p-1.5 rounded-md transition-colors ${
                  currentMessage.trim() ? 'bg-gray-200 text-gray-600 hover:bg-gray-300' : 'bg-transparent text-gray-300'
                }`}
              >
                <ChevronRight size={16} />
              </button>
            </form>
            <div className="text-center mt-2 flex justify-between items-center px-1">
              <span className="text-[10px] text-gray-400">Press ESC to return to editing mode</span>
              <span onClick={hardDisconnect} className="text-[10px] text-red-400 hover:text-red-500 cursor-pointer">Force Disconnect</span>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}