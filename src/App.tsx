/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from "react";
import { Send, Bot, User, Trash2, Loader2, MessageSquare, Sparkles, Plus, X, Paperclip, ChevronDown, Pin, Star, Edit2, Settings, Server, Filter, Brain, Download, Sun, Moon } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Mermaid } from "./components/Mermaid";
import { CodeBlock } from "./components/CodeBlock";
import { CsvPreview } from "./components/CsvPreview";
import { LatexPreview } from "./components/LatexPreview";
import { HtmlPreviewInline } from "./components/HtmlPreviewInline";
import { extractSentences } from "./lib/textRank";
import { AI_MODELS, type AIModel } from "./models";
import { FileText } from "lucide-react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

export interface AttachedFile {
  name: string;
  url: string;
  type: string;
  text?: string;
}

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  videos?: string[];
  files?: AttachedFile[];
}

interface ChatGroup {
  id: string;
  name: string;
  color: string;
  icon?: string;
}

interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  isPinned?: boolean;
  groupId?: string;
  summaryIndex?: number;
  contextSummary?: string;
}

interface ChatSession extends ChatSummary {
  messages: Message[];
}

export default function App() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [currentMessages, setCurrentMessages] = useState<Message[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Fetch from server on load
  useEffect(() => {
    const loadChats = async () => {
      let backendSettings: any = {};
      try {
        const resSettings = await fetch("/api/settings");
        if (resSettings.ok) {
           backendSettings = await resSettings.json();
           if (backendSettings.autoCompress !== undefined) setAutoCompress(backendSettings.autoCompress);
           if (backendSettings.apiKey) setApiKey(backendSettings.apiKey);
           if (backendSettings.developerName) setDeveloperName(backendSettings.developerName);
           if (backendSettings.theme) setTheme(backendSettings.theme);
           if (backendSettings.chatOrder) setChatOrder(backendSettings.chatOrder);
           if (backendSettings.favoriteModelIds) setFavoriteModelIds(backendSettings.favoriteModelIds);
           if (backendSettings.groups && backendSettings.groups.length > 0) setGroups(backendSettings.groups);
           if (backendSettings.customModels) setCustomModels(backendSettings.customModels);
        }
      } catch (e) {
        console.error("Failed to load settings:", e);
      }

      // Migrate old localStorage chats to backend
      const oldStorageKeys = ["chats", "knp_chats"];
      let migrated = false;
      for (const key of oldStorageKeys) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
              await Promise.all(parsed.map((chat: any) => 
                fetch("/api/chats", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(chat)
                })
              ));
              migrated = true;
            }
          } catch (e) {
            console.error(`Failed to migrate ${key}`, e);
          }
          localStorage.removeItem(key);
        }
      }

      try {
        const res = await fetch(`/api/chats?t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          setChats(data);
          
          const savedId = backendSettings.currentChatId;
          if (savedId && data.some((c: ChatSummary) => c.id === savedId)) {
            setCurrentChatId(savedId);
          } else if (migrated || data.length > 0) {
            setCurrentChatId(data[0]?.id);
          }
        }
      } catch (e) {
        console.error("Failed to load chats:", e);
      } finally {
        setIsLoaded(true);
      }
    };
    loadChats();
  }, []);

  const [input, setInput] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [autoCompress, setAutoCompress] = useState<boolean>(true);
  
  const [previewTarget, setPreviewTarget] = useState<{ filename: string, url?: string, content?: string, type?: string, language?: string } | null>(null);
  const [previewWidth, setPreviewWidth] = useState<number>(450);
  const [isResizingPreview, setIsResizingPreview] = useState(false);

  const [apiKey, setApiKey] = useState<string>("");
  const [developerName, setDeveloperName] = useState<string>("Developer");
  const [showSettings, setShowSettings] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [outputFormat, setOutputFormat] = useState("auto");
  const [outputLength, setOutputLength] = useState("auto");
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  const [chatOrder, setChatOrder] = useState<string[]>([]);

  const onDragEnd = (result: any) => {
    const { destination, source, type } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    if (type === "GROUP") {
      const newGroups = Array.from(groups);
      const [reorderedItem] = newGroups.splice(source.index, 1);
      newGroups.splice(destination.index, 0, reorderedItem);
      setGroups(newGroups);
      return;
    }

    if (type === "CHAT") {
      const groupChats = chats.filter(c => (c.groupId || "default") === activeGroupId);
      const sortChats = (chatsToSort: ChatSummary[]) => {
        return [...chatsToSort].sort((a, b) => {
          const idxA = chatOrder.indexOf(a.id);
          const idxB = chatOrder.indexOf(b.id);
          if (idxA !== -1 && idxB !== -1) return idxA - idxB;
          if (idxA !== -1) return -1;
          if (idxB !== -1) return 1;
          return b.updatedAt - a.updatedAt;
        });
      };
      
      const pinnedList = sortChats(groupChats.filter(c => c.isPinned));
      const recentList = sortChats(groupChats.filter(c => !c.isPinned));

      if (source.droppableId === destination.droppableId) {
        const isPinnedList = source.droppableId === "pinned-chats";
        const listToUpdate = isPinnedList ? pinnedList : recentList;
        
        const newList = Array.from(listToUpdate);
        const [reordered] = newList.splice(source.index, 1);
        newList.splice(destination.index, 0, reordered);
        
        const newOrder = [...chatOrder];
        const itemsInList = listToUpdate.map(c => c.id);
        const filteredOrder = newOrder.filter(id => !itemsInList.includes(id));
        setChatOrder([...newList.map(c => c.id), ...filteredOrder]);
      } else {
        const sourceList = source.droppableId === "pinned-chats" ? pinnedList : recentList;
        const destList = destination.droppableId === "pinned-chats" ? pinnedList : recentList;
        
        const newSourceList = Array.from(sourceList);
        const newDestList = Array.from(destList);
        
        const [movedChat] = newSourceList.splice(source.index, 1);
        newDestList.splice(destination.index, 0, movedChat);
        
        const isNowPinned = destination.droppableId === "pinned-chats";
        const updatedChat = { ...movedChat, isPinned: isNowPinned };
        
        setChats(prev => prev.map(c => c.id === movedChat.id ? updatedChat : c));
        
        fetch(`/api/chats/${movedChat.id}`)
        .then(res => res.json())
        .then((fullChat: any) => {
          fullChat.isPinned = isNowPinned;
          fetch("/api/chats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(fullChat)
          });
        });
        
        const newOrder = [...chatOrder];
        const itemsInBoth = [...sourceList.map(c => c.id), ...destList.map(c => c.id)];
        const filteredOrder = newOrder.filter(id => !itemsInBoth.includes(id));
        
        if (destination.droppableId === "pinned-chats") {
          setChatOrder([...newDestList.map(c=>c.id), ...newSourceList.map(c=>c.id), ...filteredOrder]);
        } else {
          setChatOrder([...newSourceList.map(c=>c.id), ...newDestList.map(c=>c.id), ...filteredOrder]);
        }
      }
    }
  };

  useEffect(() => {
    if (previewTarget) {
      if (previewTarget.filename.toLowerCase().match(/\.(csv|xlsx?)$/)) {
        setPreviewWidth(750);
      } else if (previewTarget.filename.toLowerCase().match(/\.(md|markdown|tex|latex)$/) || previewTarget.language === 'markdown' || previewTarget.language === 'latex' || previewTarget.language === 'tex') {
        setPreviewWidth(750);
      } else if (previewWidth !== 750 && previewWidth !== 450) {
        // Keep current custom width if they resized it
      } else {
        setPreviewWidth(450);
      }
    }
  }, [previewTarget]);

  const handlePreviewResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingPreview(true);
    const startX = e.clientX;
    const startWidth = previewWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX; 
      const newWidth = Math.max(300, Math.min(window.innerWidth - 300, startWidth + deltaX));
      setPreviewWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingPreview(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
  };
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [pendingVideos, setPendingVideos] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<AttachedFile[]>([]);
  const [isFileUploading, setIsFileUploading] = useState(false);
  const FORMAT_OPTIONS = [
    { id: "auto", label: "Auto Format" },
    { id: "plain", label: "Plain Text" },
    { id: "markdown", label: "Markdown (.md)" },
    { id: "latex", label: "LaTeX (.tex)" },
    { id: "html", label: "HTML/CSS (.html)" },
    { id: "mermaid", label: "Mermaid Diagram" },
    { id: "csv", label: "CSV File (.csv)" },
    { id: "json", label: "JSON (.json)" },
    { id: "javascript", label: "JavaScript (.js)" },
    { id: "typescript", label: "TypeScript (.ts)" },
    { id: "python", label: "Python (.py)" }
  ];

  const LENGTH_OPTIONS = [
    { id: "auto", label: "Auto Length" },
    { id: "short", label: "Short (Concise)" },
    { id: "medium", label: "Medium Length" },
    { id: "long", label: "Long (Detailed)" }
  ];

  const [isLoading, setIsLoading] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string>("claude-sonnet-4-6");
  const [favoriteModelIds, setFavoriteModelIds] = useState<string[]>([]);
  const [groups, setGroups] = useState<ChatGroup[]>([{ id: "default", name: "KNP LAB AI", color: "bg-[#5865F2]" }]);
  const [activeGroupId, setActiveGroupId] = useState<string>("default");
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null);
  
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  
  const [isManageModelsOpen, setIsManageModelsOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [customModels, setCustomModels] = useState<AIModel[]>([]);
  const [newModelConfig, setNewModelConfig] = useState({ id: "", name: "" });

  const [maxPrice, setMaxPrice] = useState<number>(Infinity);
  const [showRecommendedOnly, setShowRecommendedOnly] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const saveSettingsToServer = (overrides: any) => {
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        autoCompress: overrides.autoCompress ?? autoCompress,
        apiKey: overrides.apiKey ?? apiKey,
        developerName: overrides.developerName ?? developerName,
        theme: overrides.theme ?? theme,
        chatOrder: overrides.chatOrder ?? chatOrder,
        favoriteModelIds: overrides.favoriteModelIds ?? favoriteModelIds,
        groups: overrides.groups ?? groups,
        customModels: overrides.customModels ?? customModels,
        currentChatId: overrides.currentChatId !== undefined ? overrides.currentChatId : currentChatId
      })
    }).catch(e => console.error("Failed to save settings", e));
  };
  
  // Apply theme dynamically
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (theme === 'light') {
        document.documentElement.classList.add('light');
      } else {
        document.documentElement.classList.remove('light');
      }
    }
  }, [theme]);

  const RECOMMENDED_MODELS = [
    "claude-sonnet-4-6", "claude-opus-4-6", "gpt-4o", "gpt-4o-mini", "gemini-2.5-pro", "gemini-2.5-flash", "deepseek-v3.1", "deepseek-r1"
  ];

  const renderMarkdownComponents = useMemo(() => ({
    a({node, href, children, ...props}: any) {
      if (href && href.match(/\.(xlsx?|csv|pdf|md|tex)$/i)) {
         return (
           <a 
             href={href} 
             target="_blank"
             rel="noopener noreferrer"
             className="text-[#00A8FC] hover:underline"
             onClick={(e) => {
                e.preventDefault();
                setPreviewTarget({
                   filename: href.split('/').pop() || 'file',
                   url: href
                });
             }}
             {...props}
           >
             {children}
           </a>
         );
      }
      return <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#00A8FC] hover:underline" {...props}>{children}</a>;
    },
    table({node, ...props}: any) {
      return (
        <div className="w-full overflow-x-auto mb-4">
          <table {...props} />
        </div>
      );
    },
    img({node, src, alt, ...props}: any) {
      if (src && src.match(/\.(mp4|webm|mov|ogg)$/i)) {
        return (
          <div className="block my-3">
            <video 
              src={src} 
              controls
              className="max-w-[400px] w-full h-auto rounded-lg object-contain bg-[#1E1F22] border border-[#111214] shadow-sm"
              {...props}
            />
          </div>
        );
      }
      return (
        <div className="block my-3">
          <img 
            src={src} 
            alt={alt || "Image preview"} 
            className="max-w-[400px] w-full h-auto max-h-80 rounded-lg object-contain bg-[#1E1F22] border border-[#111214] shadow-sm cursor-pointer hover:shadow-md transition-shadow" 
            loading="lazy"
            onClick={(e) => {
              e.preventDefault();
              setZoomedImage(src || null);
            }}
            {...props}
          />
        </div>
      );
    },
    code({node, inline, className, children, ...props}: any) {
      const match = /language-([^\s]+)/.exec(className || '');
      const text = Array.isArray(children) ? children.join('') : String(children);
  
      if (!inline && match) {
        const langString = match[1];
        
        // Mermaid handling
        if (langString === 'mermaid') {
          return <Mermaid chart={text.replace(/\n$/, '')} />;
        }
        
        // Extract filename if provided as `language:filename.ext`
        let language = langString;
        let filename = undefined;
        
        if (langString.includes(':')) {
          const parts = langString.split(':');
          language = parts[0];
          filename = parts.slice(1).join(':'); // The rest is the filename
        }

        if (language === 'html' || language === 'svg') {
          return <HtmlPreviewInline content={text.replace(/\n$/, '')} />;
        }
        
        return (
          <CodeBlock 
            language={language} 
            filename={filename} 
            value={text.replace(/\n$/, '')} 
            onPreview={() => {
              setPreviewTarget({ filename: filename || 'unknown', content: text.replace(/\n$/, ''), language: language });
            }}
          />
        );
      }
      
      // For normal code blocks without a specified language, but formatted as block
      if (!inline && !match && String(children).includes('\n')) {
         return (
           <CodeBlock 
             language="text" 
             value={text.replace(/\n$/, '')} 
             onPreview={() => {
                setPreviewTarget({ filename: 'code.txt', content: text.replace(/\n$/, '') });
             }}
           />
         );
      }
  
      return (
        <code className="bg-[#1E1F22] text-[#DBDEE1] px-1.5 py-0.5 rounded-md text-[13px] font-mono border border-[#111214]" {...props}>
          {children}
        </code>
      );
    }
  }), [setPreviewTarget]);

  useEffect(() => {
    if (typeof window !== "undefined" && isLoaded) {
      saveSettingsToServer({ customModels });
    }
  }, [customModels]);

  const allModels = useMemo(() => {
    // combine but ensure no duplicate IDs (custom takes precedence)
    const combined = [...customModels, ...AI_MODELS];
    const uniqueIds = new Set();
    return combined.filter(m => {
      if (uniqueIds.has(m.id)) return false;
      uniqueIds.add(m.id);
      return true;
    });
  }, [customModels]);

  const suggestedModels = useMemo(() => {
    const suggestions: string[] = [];
    const lowerInput = input.toLowerCase();

    const isVideoRelated = /generate video|create video|make video|make a video|create a video/.test(lowerInput) || pendingVideos.length > 0;
    const isImageRelated = /generate image|create image|make image|draw|picture/.test(lowerInput) || pendingImages.length > 0;
    const isCodingRelated = /code|programming|script|debug|html|css|javascript|typescript|python|java/.test(lowerInput);
    const isReasoningRelated = /math|calculate|reason|logic|puzzle|thinking/.test(lowerInput);

    if (isVideoRelated) {
      suggestions.push("sora-2", "veo_3_1-4K", "grok-video-3");
    }
    if (isImageRelated && suggestions.length === 0) {
      suggestions.push("gemini-2.5-flash", "gpt-4o", "doubao-seedream-5-0-260128");
    }
    if (isCodingRelated) {
      suggestions.push("claude-sonnet-4-6", "gpt-5-codex", "qwen3-coder");
    }
    if (isReasoningRelated) {
      suggestions.push("deepseek-r1", "claude-opus-4-6-thinking");
    }

    if (pendingFiles.length > 0 && suggestions.length === 0) {
       suggestions.push("gemini-2.5-pro", "claude-sonnet-4-6", "gpt-4o");
    }

    if (input.length > 1000 && suggestions.length === 0) {
       suggestions.push("gemini-2.5-pro", "claude-opus-4-6");
    }

    const unique = Array.from(new Set(suggestions)).slice(0, 3);
    return unique.map(id => allModels.find(x => x.id === id)).filter(Boolean) as typeof AI_MODELS;
  }, [input, pendingImages, pendingVideos, pendingFiles, allModels]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && isLoaded) {
      saveSettingsToServer({ groups });
    }
  }, [groups]);

  const selectedModel = useMemo(() => allModels.find(m => m.id === selectedModelId), [selectedModelId, allModels]);

  const groupedModels = useMemo(() => {
    const groups: Record<string, typeof AI_MODELS> = {};
    const favs = allModels.filter(m => favoriteModelIds.includes(m.id));
    if (favs.length > 0) groups["⭐ Favorites"] = favs;
    
    if (customModels.length > 0) groups["Custom Models"] = customModels;

    const filteredModels = allModels.filter(model => {
      // Filter out empty costs to be safe, treat NaN as 0 or ignore it
      const outCost = parseFloat(model.outputCost?.replace(/[^\d.]/g, '') || '0');
      // Always allow favorites if they are in favorites list - actually maybe just filter everywhere
      if (maxPrice !== Infinity && outCost > maxPrice) return false;
      if (showRecommendedOnly && !RECOMMENDED_MODELS.includes(model.id)) return false;
      return true;
    });

    // Also sorting them by output cost
    filteredModels.sort((a, b) => {
      const costA = parseFloat(a.outputCost?.replace(/[^\d.]/g, '') || '0');
      const costB = parseFloat(b.outputCost?.replace(/[^\d.]/g, '') || '0');
      return costA - costB;
    });

    return filteredModels.reduce((acc, model) => {
      if (!acc[model.provider]) acc[model.provider] = [];
      acc[model.provider].push(model);
      return acc;
    }, groups);
  }, [favoriteModelIds, allModels, customModels, maxPrice, showRecommendedOnly]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsFileUploading(true);
    let errorCount = 0;

    let activeChatId = currentChatId;
    if (!activeChatId) {
      activeChatId = Date.now().toString();
      setCurrentChatId(activeChatId);
    }

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        try {
          const res = await fetch(`/api/chats/${activeChatId}/upload`, { method: "POST", body: formData });
          if (res.ok) {
            const data = await res.json();
            if (data.url) {
              if (data.type === "image") {
                setPendingImages(prev => [...prev, data.url]);
              } else if (data.type === "video") {
                setPendingVideos(prev => [...prev, data.url]);
              } else {
                setPendingFiles(prev => [...prev, data]);
              }
            }
          } else {
            console.error("Upload failed", await res.text());
            errorCount++;
          }
        } catch (err) {
          console.error("Failed to upload file", err);
          errorCount++;
        }
      }
      
      if (errorCount > 0) {
        alert(`${errorCount} file(s) failed to upload. Please check the network connection and try again.`);
      }
    } finally {
      setIsFileUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Auto-scroll when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [currentMessages.length]);

  useEffect(() => {
    if (currentChatId) {
      if (isLoaded) saveSettingsToServer({ currentChatId: currentChatId });
      // Fetch full chat details
      fetch(`/api/chats/${currentChatId}?t=${Date.now()}`)
        .then(res => res.json())
        .then(data => {
          setCurrentMessages(data.messages || []);
        })
        .catch(e => {
          console.error("Failed to fetch messages", e);
          setCurrentMessages([]);
        });
    } else {
      if (isLoaded) saveSettingsToServer({ currentChatId: null });
      setCurrentMessages([]);
    }
  }, [currentChatId]);

  useEffect(() => {
    if (isLoaded) saveSettingsToServer({ favoriteModelIds });
  }, [favoriteModelIds]);

  const toggleFavoriteModel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFavoriteModelIds(prev => 
      prev.includes(selectedModelId) 
        ? prev.filter(id => id !== selectedModelId) 
        : [...prev, selectedModelId]
    );
  };

  const handleCreateNewChat = () => {
    setCurrentChatId(null);
    setIsMobileMenuOpen(false);
  };

  const handleSelectChat = (id: string) => {
    setCurrentChatId(id);
    setIsMobileMenuOpen(false);
  };

  const handleDeleteChat = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newChats = chats.filter(c => c.id !== id);
    setChats(newChats);
    if (currentChatId === id) {
      setCurrentChatId(null);
      setCurrentMessages([]);
    }
    fetch(`/api/chats/${id}`, { method: "DELETE" }).catch(e => console.error("Failed to delete chat:", e));
  };

  const handleTogglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    // We only have ChatSummary in state, so we update the pin locally, 
    // and instruct the backend to re-save the file with the toggled pin.
    // Easiest is to fetch the full chat, toggle it, and post it back.
    fetch(`/api/chats/${id}`)
      .then(res => res.json())
      .then((fullChat: ChatSession) => {
        fullChat.isPinned = !fullChat.isPinned;
        fetch("/api/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fullChat)
        }).catch(err => console.error(err));
      });

    setChats(prev => {
      const chatToUpdate = prev.find(c => c.id === id);
      if (!chatToUpdate) return prev;
      const updated = { ...chatToUpdate, isPinned: !chatToUpdate.isPinned };
      
      return [updated, ...prev.filter(c => c.id !== id)].sort((a, b) => b.updatedAt - a.updatedAt);
    });
  };

  const handleSummarizeContext = async (targetChatId?: string) => {
    const actChatId = targetChatId || currentChatId;
    if (!actChatId) return;
    const chatSum = chats.find(c => c.id === actChatId);
    if (!chatSum) return;

    setIsSummarizing(true);
    try {
      const fullChatRes = await fetch(`/api/chats/${actChatId}`);
      if (!fullChatRes.ok) throw new Error("Failed to load full chat");
      const fullChat: ChatSession = await fullChatRes.json();
      
      const activeMessages = fullChat.messages || [];
      if (fullChat.summaryIndex === activeMessages.length) return; // already summarized

      const startIndex = fullChat.summaryIndex || 0;
      const unsummarizedMessages = activeMessages.slice(startIndex);

      const mappedMessages = unsummarizedMessages.map(m => {
        let contentArray: any[] = [];
        if (m.content) contentArray.push({ type: "text", text: m.content });
        if (m.files && m.files.length > 0) {
          const fileContext = m.files.map((f: AttachedFile) => `File: ${f.name}\n\n${f.text || ""}`).join("\n\n---\n\n");
          if (contentArray.length === 0) contentArray.push({ type: "text", text: `[User provided files]\n${fileContext}` });
          else contentArray[0].text = `[User provided files]\n${fileContext}\n\nUser Question:\n${contentArray[0].text}`;
        }
        if (m.images && m.images.length > 0) {
          contentArray.push(...m.images.map((img: string) => ({ type: "image_url", image_url: { url: img } })));
        }
        if (contentArray.length === 1) return { role: m.role, content: contentArray[0].text };
        return { role: m.role, content: contentArray };
      });

      // Local Structural Stack + TextRank compression
      // 1. Combine unsummarized messages into a single text document
      const docRaw = mappedMessages.map((m: { role: string; content: any }) => {
        const txt = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content.map((c: any) => c.text || '').join(' ') : '');
        return `${m.role.toUpperCase()}: ${txt}`;
      }).join('\n\n');

      let combinedText = docRaw;
      if (fullChat.contextSummary) {
        combinedText = fullChat.contextSummary + "\n\n" + docRaw;
      }

      // 2. Extract top N sentences (bound by a max to prevent unbounded growth)
      const extracted = extractSentences(combinedText, Math.max(8, Math.floor(activeMessages.length / 2)));
      
      fullChat.contextSummary = `[COMPRESSED HISTORY (TextRank)]\n${extracted}`;
      fullChat.summaryIndex = activeMessages.length;
      
      await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fullChat)
      });
      
      setChats(prev => prev.map(c => c.id === actChatId ? { ...c, summaryIndex: fullChat.summaryIndex, contextSummary: fullChat.contextSummary } : c));
    } catch (e) {
      console.error("Failed to summarize context:", e);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleSend = async () => {
    if ((!input.trim() && pendingImages.length === 0 && pendingVideos.length === 0 && pendingFiles.length === 0) || isLoading || isFileUploading) return;

    const userMessage: Message = { 
      role: "user", 
      content: input,
      images: pendingImages.length > 0 ? [...pendingImages] : undefined,
      videos: pendingVideos.length > 0 ? [...pendingVideos] : undefined,
      files: pendingFiles.length > 0 ? [...pendingFiles] : undefined
    };
    const currentInput = input;
    setInput("");
    setPendingImages([]);
    setPendingVideos([]);
    setPendingFiles([]);
    setIsLoading(true);

    let activeChatId = currentChatId;
    let activeMessages = currentMessages;
    let updatedChat: ChatSession | null = null;

    // If there is no active chat, create one
    if (!activeChatId) {
      activeChatId = Date.now().toString();
      const titleText = currentInput.trim() || (pendingFiles.length > 0 ? pendingFiles[0].name : "New Chat");
      const newChat: ChatSession = {
        id: activeChatId,
        title: titleText.substring(0, 30) + (titleText.length > 30 ? "..." : ""),
        messages: [userMessage],
        updatedAt: Date.now(),
        groupId: activeGroupId
      };
      updatedChat = newChat;
      setChats(prev => [{ id: newChat.id, title: newChat.title, updatedAt: newChat.updatedAt, isPinned: newChat.isPinned, groupId: newChat.groupId }, ...prev]);
      setCurrentChatId(activeChatId);
      setCurrentMessages([userMessage]);
      activeMessages = [userMessage];
    } else {
      // Update existing chat
      const existingChat = chats.find(c => c.id === activeChatId);
      updatedChat = {
        id: activeChatId,
        title: existingChat?.title || "New Chat",
        messages: [...activeMessages, userMessage],
        updatedAt: Date.now(),
        isPinned: existingChat?.isPinned,
        groupId: existingChat?.groupId,
        summaryIndex: existingChat?.summaryIndex,
        contextSummary: existingChat?.contextSummary
      };
      
      const { messages: _omittedMsg, ...summaryForState } = updatedChat;
      setChats(prev => [summaryForState, ...prev.filter(c => c.id !== activeChatId)]);
      setCurrentMessages([...activeMessages, userMessage]);
      activeMessages = [...activeMessages, userMessage];
    }

    if (updatedChat) {
      fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedChat)
      }).catch(e => console.error("Failed to save chat:", e));
    }

    try {
      const existingChatSum = chats.find(c => c.id === activeChatId);
      const startIndex = existingChatSum?.summaryIndex || 0;
      const contextSummary = existingChatSum?.contextSummary;
      
      const processableMessages = activeMessages.slice(startIndex);

      const formattedMessages = processableMessages.map((m, index) => {
        let contentArray: any[] = [{ type: "text", text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }];
        
        // Context Optimization: Drop file contents for older un-summarized turns
         const isRecent = index >= processableMessages.length - 2;

        if (m.files && m.files.length > 0) {
          let fileContext;
          if (isRecent) {
             fileContext = m.files.map(f => `--- Attached File: ${f.name} ---\n${f.text || ''}\n--- End of File ---`).join("\n\n");
          } else {
             fileContext = m.files.map(f => `--- Attached File: ${f.name} ---\n[File content omitted from prompt to save tokens]\n--- End of File ---`).join("\n\n");
          }

          if (m.content) {
            contentArray[0].text = `[User provided the following files]\n${fileContext}\n\n[User Message]\n${typeof m.content === 'object' ? JSON.stringify(m.content) : m.content}`;
          } else {
            contentArray[0].text = `[User provided the following files]\n${fileContext}`;
          }
        }
        
        if (m.images && m.images.length > 0) {
          contentArray.push(...m.images.map(img => ({ type: "image_url", image_url: { url: typeof img === 'string' ? img : (img as any).url || "" } })));
        }
        
        if (contentArray.length === 1) {
          return { role: m.role, content: contentArray[0].text };
        }
        return { role: m.role, content: contentArray };
      });

      if (contextSummary) {
          formattedMessages.unshift({
             role: "system",
             content: `[SUMMARY OF PREVIOUS CONTEXT (Graph Layer / Knowledge Base)]\n${contextSummary}\n\n[INSTRUCTIONS]\nYou must use the provided context summary above to inform your answers, as it contains the compressed history of the chat. Do not ask me to repeat things that are in the knowledge graph.`
          });
      }

      if (outputFormat !== 'auto') {
        const formatLabel = FORMAT_OPTIONS.find(f => f.id === outputFormat)?.label;
        if (formatLabel && formattedMessages.length > 0) {
           const lastMsg = formattedMessages[formattedMessages.length - 1];
           if (lastMsg.role === 'user') {
               const overrideText = `\n\n[USER_STYLED_OUTPUT_OVERRIDE]\nThe user has explicitly requested that the primary output for their last message be in ${formatLabel} format. YOU MUST output the results inside a ${outputFormat === 'plain' ? 'text' : outputFormat} code block. Do NOT include conversational filler.`;
               if (typeof lastMsg.content === 'string') {
                   lastMsg.content += overrideText;
               } else if (Array.isArray(lastMsg.content)) {
                   lastMsg.content[0].text += overrideText;
               }
           }
        }
      }

      if (outputLength !== 'auto') {
        if (formattedMessages.length > 0) {
           const lastMsg = formattedMessages[formattedMessages.length - 1];
           if (lastMsg.role === 'user') {
               const overrideText = `\n\n[USER_OUTPUT_LENGTH_OVERRIDE]\nThe user has requested that your response be of **${outputLength.toUpperCase()}** length. Please adjust your verbosity, detail, and explanation accordingly.`;
               if (typeof lastMsg.content === 'string') {
                   lastMsg.content += overrideText;
               } else if (Array.isArray(lastMsg.content)) {
                   lastMsg.content[0].text += overrideText;
               }
           }
        }
      }

      if (!apiKey) {
        setShowSettings(true);
        setIsLoading(false);
        // Add a temporary error message that doesn't get saved
        setCurrentMessages(prev => [...prev, {
          role: "assistant",
          content: "Please set your KNP LAB AI API Key in the settings before sending a message."
        }]);
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s timeout

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-knp-api-key": apiKey
        },
        body: JSON.stringify({
          messages: formattedMessages,
          model: selectedModelId,
          chatId: activeChatId,
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        let errText = await response.text();
        try {
          const parsed = JSON.parse(errText);
          if (parsed && parsed.error) errText = parsed.error;
        } catch(e) {}
        console.error("API error response:", errText);
        throw new Error(errText);
      }

      const data = await response.json();
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
         throw new Error("Invalid response format from KNP Lab AI");
      }
      const assistantMessage: Message = {
        role: "assistant",
        content: data.choices[0].message.content || "",
      };

      const existingChatSummary = chats.find(c => c.id === activeChatId);
      const newFullChat: ChatSession = {
        id: activeChatId,
        title: existingChatSummary?.title || "New Chat",
        messages: [...activeMessages, assistantMessage],
        updatedAt: Date.now(),
        isPinned: existingChatSummary?.isPinned,
        groupId: existingChatSummary?.groupId,
        summaryIndex: existingChatSummary?.summaryIndex,
        contextSummary: existingChatSummary?.contextSummary
      };

      fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newFullChat)
      }).catch(e => console.error("Failed to save chat:", e));

      setChats(prev => {
        const chatToUpdate = prev.find(c => c.id === activeChatId);
        if (!chatToUpdate) return prev;
        const updatedSum = { ...chatToUpdate, updatedAt: newFullChat.updatedAt };
        return [updatedSum, ...prev.filter(c => c.id !== activeChatId)];
      });
      setCurrentMessages([...activeMessages, assistantMessage]);
    } catch (error: any) {
      console.error("Error:", error);
      let errMsgText = "Sorry, I encountered an error. Please try again later.";
      try {
        const parsed = JSON.parse(error.message);
        if (parsed && parsed.error) {
           errMsgText = `API Error: ${parsed.error}`;
        }
      } catch (e) {
        if (error.message) {
           errMsgText = `Error: ${error.message}`;
        }
      }
      const errMessage: Message = { role: "assistant" as const, content: errMsgText };
      
      const existingChatErrorSum = chats.find(c => c.id === activeChatId);
      const errChat: ChatSession = {
        id: activeChatId,
        title: existingChatErrorSum?.title || "New Chat",
        messages: [...activeMessages, errMessage],
        updatedAt: Date.now(),
        isPinned: existingChatErrorSum?.isPinned,
        groupId: existingChatErrorSum?.groupId,
        summaryIndex: existingChatErrorSum?.summaryIndex,
        contextSummary: existingChatErrorSum?.contextSummary
      };

      fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(errChat)
      }).catch(e => console.error("Failed to save chat:", e));

      setChats(prev => {
        const chatToUpdate = prev.find(c => c.id === activeChatId);
        if (!chatToUpdate) return prev;
        const updatedSum = { ...chatToUpdate, updatedAt: errChat.updatedAt };
        return [updatedSum, ...prev.filter(c => c.id !== activeChatId)];
      });
      setCurrentMessages([...activeMessages, errMessage]);
    } finally {
      setIsLoading(false);
      if (autoCompress) {
        handleSummarizeContext(activeChatId);
      }
    }
  };

  const handleGroupSelect = (groupId: string) => {
    setActiveGroupId(groupId);
    setCurrentChatId(null);
    setCurrentMessages([]);
  };

  const handleDeleteGroup = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setGroupToDelete(groupId);
  };

  const confirmDeleteGroup = () => {
    if (!groupToDelete) return;
    const chatsToDelete = chats.filter(c => c.groupId === groupToDelete);
    chatsToDelete.forEach(chat => {
      fetch(`/api/chats/${chat.id}`, { method: "DELETE" }).catch(err => console.error(err));
    });
    setChats(prev => prev.filter(c => c.groupId !== groupToDelete));
    setGroups(prev => prev.filter(g => g.id !== groupToDelete));
    if (activeGroupId === groupToDelete) {
      handleGroupSelect("default");
    }
    setGroupToDelete(null);
  };

  const clearAllChats = () => {
    chats.forEach(chat => {
      fetch(`/api/chats/${chat.id}`, { method: "DELETE" }).catch(e => console.error(e));
    });
    setChats([]);
    setCurrentChatId(null);
    setCurrentMessages([]);
  };

  const handleRenameChat = async (id: string) => {
    if (!editingTitle.trim()) {
      setEditingChatId(null);
      return;
    }
    try {
      const fullChatRes = await fetch(`/api/chats/${id}`);
      if (fullChatRes.ok) {
        const fullChat = await fullChatRes.json();
        fullChat.title = editingTitle;
        await fetch("/api/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fullChat)
        });
      }
      setChats(prev => prev.map(c => c.id === id ? { ...c, title: editingTitle } : c));
    } catch (e) {
      console.error(e);
    }
    setEditingChatId(null);
  };

  const groupChats = chats.filter(c => (c.groupId || "default") === activeGroupId);
  const pinnedChats = groupChats.filter(c => c.isPinned);
  const recentChats = groupChats.filter(c => !c.isPinned);

  const renderChatItem = (chat: ChatSummary, index: number) => {
    const isEditing = editingChatId === chat.id;
    return (
      <Draggable key={chat.id} draggableId={chat.id} index={index}>
        {(provided, snapshot) => (
          <div 
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            onClick={() => !isEditing && handleSelectChat(chat.id)}
            className={`group flex items-center justify-between px-2 py-1.5 rounded text-[15px] cursor-pointer transition-colors ${
              currentChatId === chat.id 
                ? 'bg-[#404249] text-white' 
                : 'text-[#949BA4] hover:bg-[#35373C] hover:text-[#DBDEE1]'
            } ${snapshot.isDragging ? 'shadow-lg bg-[#35373C]' : ''}`}
            style={{ ...provided.draggableProps.style }}
          >
            <div className="flex items-center gap-3 overflow-hidden flex-1">
                <div className="w-6 h-6 rounded-full bg-[#1E1F22] flex items-center justify-center shrink-0">
                  <Bot className="w-3.5 h-3.5 text-blue-400" />
                </div>
                {isEditing ? (
                  <input
                    type="text"
                    autoFocus
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={() => handleRenameChat(chat.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameChat(chat.id);
                      if (e.key === 'Escape') setEditingChatId(null);
                    }}
                    className="bg-[#1E1F22] text-[#DBDEE1] px-1 py-0.5 rounded text-sm w-full outline-none border border-[#5865F2]"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <div className="truncate pr-2 font-medium">{chat.title}</div>
                )}
            </div>
            {!isEditing && (
              <div className="hidden group-hover:flex items-center gap-1">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingChatId(chat.id);
                    setEditingTitle(chat.title);
                  }}
                  className="p-1 hover:text-white"
                  title="Edit"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
                <button 
                  onClick={(e) => handleTogglePin(chat.id, e)}
                  className="p-1 hover:text-white"
                  title={chat.isPinned ? "Unpin" : "Pin"}
                >
                  <Pin className={`w-3 h-3 ${chat.isPinned ? 'fill-current' : ''}`} />
                </button>
                <button 
                  onClick={(e) => handleDeleteChat(chat.id, e)}
                  className="p-1 hover:text-red-400"
                  title="Delete"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}
      </Draggable>
    );
  };

  const handleExportPdf = () => {
    if (!previewTarget) return;

    if (previewTarget.filename.toLowerCase().match(/\.(tex|latex)$/) || previewTarget.language === 'latex' || previewTarget.language === 'tex') {
      // Export latex iframe contents
      const iframe = document.querySelector('iframe[title="LaTeX Preview"]') as HTMLIFrameElement;
      if (iframe && iframe.contentWindow) {
         iframe.contentWindow.print();
      }
      return;
    }

    if (previewTarget.filename.toLowerCase().match(/\.(md|markdown)$/) || previewTarget.language === 'markdown') {
      // Export markdown body
      const element = document.querySelector('.document-preview') as HTMLElement;
      if (element) {
        const printIframe = document.createElement('iframe');
        printIframe.style.position = 'absolute';
        printIframe.style.width = '0px';
        printIframe.style.height = '0px';
        printIframe.style.border = 'none';
        document.body.appendChild(printIframe);

        const doc = printIframe.contentWindow?.document;
        if (doc) {
          doc.open();
          doc.write(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>${previewTarget.filename || 'export'}</title>
                ${document.head.innerHTML}
                <style>
                  body { background: white !important; margin: 0; padding: 0; }
                  .document-preview { 
                     margin: 0 !important; 
                     padding: 15mm !important; 
                     box-shadow: none !important;
                     min-height: auto !important;
                     max-width: none !important;
                  }
                  @media print {
                     @page { margin: 0; }
                     body { padding: 0; }
                     /* Ensure background colors and images are printed */
                     * {
                       -webkit-print-color-adjust: exact !important;
                       print-color-adjust: exact !important;
                     }
                  }
                </style>
              </head>
              <body>
                <div class="document-preview markdown-body discord-markdown">
                  ${element.innerHTML}
                </div>
              </body>
            </html>
          `);
          doc.close();

          printIframe.contentWindow?.focus();
          
          setTimeout(() => {
            printIframe.contentWindow?.print();
            setTimeout(() => {
              document.body.removeChild(printIframe);
            }, 1000);
          }, 800);
        }
      }
      return;
    }

    // Default: try to print current view
    window.print();
  };

  return (
    <div className="flex flex-col h-screen bg-[#1E1F22] text-[#DBDEE1] font-sans overflow-hidden select-none">
      {/* Fake Window Title Bar */}
      <div className="h-[22px] w-full flex items-center justify-between px-3 bg-[#18191c] shrink-0 custom-drag border-b border-[#111214] z-50 select-none" style={{ WebkitAppRegion: "drag", appRegion: "drag" } as React.CSSProperties}>
        <div className="text-[11px] font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-[#DBDEE1] to-[#7289da] tracking-wide">KNP LAB AI</div>
        <div className="flex gap-2" style={{ WebkitAppRegion: "no-drag", appRegion: "no-drag" } as React.CSSProperties}>
          <button className="w-3 h-3 rounded-full bg-[#ED6A5E] hover:opacity-80 shadow-sm"></button>
          <button className="w-3 h-3 rounded-full bg-[#F4BF4F] hover:opacity-80 shadow-sm"></button>
          <button className="w-3 h-3 rounded-full bg-[#61C554] hover:opacity-80 shadow-sm"></button>
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex flex-1 overflow-hidden select-text">
          {/* Mobile Sidebar Overlay */}
        {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Server Column (Discord-like) */}
        <div className="hidden md:flex w-[72px] bg-[#1E1F22] flex-col items-center py-3 gap-2 shrink-0 z-20 pt-3 select-none overflow-y-auto no-scrollbar">
          <Droppable droppableId="groups" type="GROUP">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className="w-full flex flex-col items-center gap-2">
                {groups.map((group, index) => (
                  <Draggable key={group.id} draggableId={group.id} index={index}>
                    {(dragProvided, dragSnapshot) => (
                      <div 
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        {...dragProvided.dragHandleProps}
                        className={`group relative flex items-center justify-center w-full cursor-pointer ${dragSnapshot.isDragging ? 'z-50 opacity-80' : ''}`}
                        onClick={() => handleGroupSelect(group.id)}
                        title={group.name}
                        style={{ ...dragProvided.draggableProps.style }}
                      >
                        <div className={`absolute left-0 w-1 ${activeGroupId === group.id ? 'h-10 bg-white' : 'h-0 group-hover:h-5 bg-white'} rounded-r-lg transition-all duration-200`}></div>
                        <div className={`w-12 h-12 ${group.color || 'bg-[#5865F2]'} rounded-[24px] hover:rounded-[16px] ${activeGroupId === group.id ? 'rounded-[16px]' : ''} flex items-center justify-center transition-all duration-200 overflow-hidden relative ${dragSnapshot.isDragging ? 'shadow-xl transform scale-105' : ''}`}>
                          <span className="text-white font-bold text-sm text-center px-1 break-words leading-tight pointer-events-none select-none">{group.name.substring(0, 4)}</span>
                        </div>
                        {group.id !== "default" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.id, e); }}
                            className="absolute p-1 top-0 right-1 bg-[#2B2D31] hover:bg-[#ED4245] text-[#DBDEE1] hover:text-white rounded-full shadow-md border border-[#1E1F22] transition-transform transform scale-0 group-hover:scale-100 z-10"
                            title="Delete Group"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
          <div className="w-8 h-[2px] bg-[#35363C] rounded-full mx-auto my-1"></div>
          <div 
            className="group relative flex items-center justify-center w-full cursor-pointer text-[#61C554] hover:text-white"
            onClick={() => setIsCreateGroupOpen(true)}
            title="Create New Group"
          >
            <div className="absolute left-0 w-1 h-0 bg-white rounded-r-lg group-hover:h-5 transition-all duration-200"></div>
            <div className="w-12 h-12 bg-[#313338] hover:bg-[#61C554] rounded-[24px] hover:rounded-[16px] flex items-center justify-center transition-all duration-200">
               <Plus className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Channels Column */}
        <aside className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-[#2B2D31] flex flex-col transition-transform duration-300 transform
          ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}
          md:relative md:translate-x-0 md:flex flex-shrink-0 select-none
        `}>
          <div className="h-12 px-4 shadow-[0_1px_2px_rgba(0,0,0,0.2)] flex items-center justify-between shrink-0 top-0 z-10 w-full bg-[#2B2D31]">
            <h1 className="font-bold text-[15px] truncate text-white">Direct Messages</h1>
          </div>
          
          <div className="px-2 pt-4">
            <button 
              onClick={handleCreateNewChat}
              className="w-full py-1.5 px-2 bg-[#1E1F22] hover:bg-[#111214] text-[#DBDEE1] rounded text-[13px] font-medium flex items-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New DM
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto mt-4 custom-scrollbar flex flex-col gap-2">
            <Droppable droppableId="pinned-chats" type="CHAT">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className="min-h-[20px]">
                  {pinnedChats.length > 0 && (
                    <div className="text-[12px] uppercase tracking-wider text-[#949BA4] font-semibold mb-1 px-4 flex justify-between items-center hover:text-[#DBDEE1] cursor-pointer">
                      <span>Pinned</span>
                    </div>
                  )}
                  <div className="space-y-0.5 px-2">
                    {pinnedChats.map((chat, idx) => renderChatItem(chat, idx))}
                    {provided.placeholder}
                  </div>
                </div>
              )}
            </Droppable>

            <Droppable droppableId="recent-chats" type="CHAT">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className="min-h-[20px] flex-1">
                  {recentChats.length > 0 && (
                    <div className="text-[12px] uppercase tracking-wider text-[#949BA4] font-semibold mb-1 px-4 flex justify-between items-center hover:text-[#DBDEE1] cursor-pointer mt-2">
                      <span>Direct Messages</span>
                    </div>
                  )}
                  <div className="space-y-0.5 px-2">
                    {recentChats.map((chat, idx) => renderChatItem(chat, idx))}
                    {provided.placeholder}
                  </div>
                </div>
              )}
            </Droppable>

            {chats.length === 0 && (
               <div className="px-4 py-3 text-sm text-[#949BA4] italic">
                 No direct messages
               </div>
            )}
          </nav>
          
          <div className="mt-auto h-[52px] bg-[#232428] px-2 flex items-center justify-between shrink-0">
            <div 
              onClick={() => setShowSettings(true)}
              className="flex flex-1 items-center gap-2 hover:bg-[#3F4147] p-1 rounded cursor-pointer transition-colors min-w-0"
            >
              <div className="w-8 h-8 rounded-full bg-[#5865F2] flex items-center justify-center flex-shrink-0 relative">
                <User className="w-5 h-5 text-white" />
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-[#232428]"></div>
              </div>
              <div className="overflow-hidden hidden sm:block">
                <div className="text-[14px] font-semibold text-white truncate leading-tight">{developerName}</div>
                <div className="text-[12px] text-[#949BA4] truncate leading-tight">{apiKey ? 'API Key Set' : 'Setup API Key'}</div>
              </div>
            </div>
            
            <div className="flex items-center gap-1 ml-1 shrink-0">
              <button 
                onClick={(e) => {
                   e.stopPropagation();
                   setTheme(theme === 'dark' ? 'light' : 'dark');
                }}
                className="p-1.5 hover:bg-[#3F4147] rounded cursor-pointer transition-colors text-[#DBDEE1]"
                title="Toggle Theme"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="p-1.5 hover:bg-[#3F4147] rounded cursor-pointer transition-colors text-[#DBDEE1]"
                title="User Settings"
              >
                 <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* Main Chat Area and Preview Area Split */}
        <div className="flex-1 flex overflow-hidden min-w-0">
          <main className="flex-1 bg-[#313338] flex flex-col relative min-w-0 border-r border-[#1E1F22]">
            {/* Header */}
          <header className="h-12 px-4 shadow-[0_1px_2px_rgba(0,0,0,0.2)] flex items-center justify-between shrink-0 top-0 z-10 bg-[#313338] border-b border-[#1E1F22] select-none">
            <div className="flex items-center gap-2 overflow-hidden">
              <button 
                onClick={() => setIsMobileMenuOpen(true)}
                className="md:hidden p-1 text-[#DBDEE1] hover:text-white transition-colors"
              >
                <MessageSquare className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2 text-white font-bold text-[16px] truncate">
                <span className="text-[#80848E] text-2xl font-normal leading-none -mt-1">@</span>
                <span>{currentChatId ? (chats.find(c => c.id === currentChatId)?.title || "Unknown") : "New Direct Message"}</span>
              </div>
            </div>
            <div className="flex gap-4 items-center shrink-0">
              <div className="hidden sm:flex items-center bg-[#1E1F22] rounded text-sm px-2 py-1 gap-2 border border-[#111214] shadow-sm">
                <select
                    value={selectedModelId}
                    onChange={(e) => setSelectedModelId(e.target.value)}
                    className="bg-transparent text-[#DBDEE1] font-medium font-sans text-[13px] outline-none cursor-pointer max-w-[280px] truncate"
                  >
                    {Object.entries(groupedModels).map(([provider, models]) => (
                      <optgroup key={provider} label={provider} className="bg-[#1E1F22] text-[#949BA4] font-semibold">
                        {models.map(model => (
                          <option key={model.id} value={model.id} className="bg-[#1E1F22] text-[#DBDEE1]">
                            {RECOMMENDED_MODELS.includes(model.id) ? "★ " : ""}{model.name} {model.outputCost && parseFloat(model.outputCost.replace(/[^\d.]/g, '')) > 0 ? `($${parseFloat(model.outputCost.replace(/[^\d.]/g, ''))}/M)` : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                </select>
                <button 
                  onClick={toggleFavoriteModel}
                  className={`hover:scale-110 transition-transform ${favoriteModelIds.includes(selectedModelId) ? "text-yellow-400" : "text-[#949BA4] hover:text-[#DBDEE1]"}`}
                  title="Favorite Model"
                >
                  <Star className={`w-3.5 h-3.5 ${favoriteModelIds.includes(selectedModelId) ? "fill-yellow-400" : ""}`} />
                </button>
                <button 
                  onClick={() => setIsManageModelsOpen(true)}
                  className="hover:scale-110 transition-transform text-[#949BA4] hover:text-[#DBDEE1]"
                  title="Manage Custom Models"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
                <div className="relative flex items-center">
                  <button 
                    onClick={() => setIsFilterOpen(!isFilterOpen)}
                    className={`hover:scale-110 transition-transform ${isFilterOpen ? "text-[#DBDEE1]" : "text-[#949BA4] hover:text-[#DBDEE1]"}`}
                    title="Filter Models"
                  >
                    <Filter className="w-3.5 h-3.5" />
                  </button>
                  {isFilterOpen && (
                    <div className="absolute right-0 top-full mt-2 w-64 bg-[#2B2D31] rounded flex flex-col p-3 border border-[#1E1F22] shadow-xl z-50">
                      <div className="text-white text-xs font-bold mb-3 uppercase tracking-wider">Model Filters</div>
                      
                      <div className="flex items-center justify-between mb-3 text-sm text-[#DBDEE1]">
                        <span>Max Output Cost ($/1M)</span>
                        <input 
                          type="number"
                          className="w-16 bg-[#1E1F22] outline-none border border-[#111214] rounded px-1.5 py-1 text-right text-xs appearance-none"
                          value={maxPrice === Infinity ? "" : maxPrice}
                          onChange={(e) => setMaxPrice(e.target.value ? Number(e.target.value) : Infinity)}
                          placeholder="Any"
                        />
                      </div>
                      
                      <label className="flex items-center gap-2 text-xs text-[#DBDEE1] cursor-pointer hover:text-white pb-1 border-t border-[#111214] pt-3">
                        <input 
                          type="checkbox"
                          checked={showRecommendedOnly}
                          onChange={(e) => setShowRecommendedOnly(e.target.checked)}
                          className="cursor-pointer"
                        />
                        Recommended Models Only
                      </label>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-[#DBDEE1] cursor-pointer hover:text-white" title="Automatically compress context after every message to save tokens">
                  <input 
                    type="checkbox"
                    checked={autoCompress}
                    onChange={(e) => setAutoCompress(e.target.checked)}
                    className="cursor-pointer"
                  />
                  Auto-Compress
                </label>
                {currentMessages.length > 0 && !autoCompress && (
                  <button 
                    onClick={() => handleSummarizeContext(currentChatId)}
                    disabled={isSummarizing || isLoading}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-sm font-medium transition-colors ${
                       chats.find(c => c.id === currentChatId)?.summaryIndex === currentMessages.length 
                         ? 'bg-[#1E1F22] border border-[#5865F2] text-[#5865F2]' 
                         : 'bg-[#1E1F22] border border-[#111214] text-[#949BA4] hover:text-[#DBDEE1]'
                    } ${currentMessages.length < 3 ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={currentMessages.length < 3 ? "Need a longer chat to compress context" : "Compress history into a Graph Summary to save tokens"}
                  >
                    <Brain className={`w-4 h-4 ${isSummarizing ? 'animate-pulse' : ''}`} />
                    {isSummarizing ? "Compressing..." : "Compress context"}
                  </button>
                )}
              </div>
              <button 
                onClick={clearAllChats}
                className="text-[#B5BAC1] hover:text-red-400 transition-colors ml-2"
                title="Clear All Chats"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </header>

        {/* Messages */}
          <div 
            ref={scrollRef}
            className="flex-1 overflow-y-auto pt-6 scroll-smooth custom-scrollbar"
          >
             {/* Initial View */}
            {currentMessages.length === 0 && (
              <div className="mt-auto pt-16 px-4 mb-6 space-y-3 max-w-3xl">
                <div className="w-[68px] h-[68px] bg-[#5865F2] rounded-full flex items-center justify-center mb-2">
                  <Bot className="w-10 h-10 text-white" />
                </div>
                <h3 className="text-[32px] font-bold text-white leading-tight">Welcome to {selectedModel?.name || "AI"}</h3>
                <p className="text-[#B5BAC1] text-[16px]">
                  This is the beginning of your direct message history with <strong className="text-white font-medium">@{selectedModel?.name || "AI"}</strong>.
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  {[
                    "What can you do?",
                    "Tell me about KNP Lab AI",
                    "Write a short story",
                    "How to use this API?"
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setInput(suggestion)}
                      className="px-4 py-1.5 rounded-full bg-[#2B2D31] hover:bg-[#3F4147] border border-[#1E1F22] hover:border-[#4E5058] transition-all text-[14px] text-[#DBDEE1] font-medium"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-0.5 pb-2">
              <AnimatePresence initial={false}>
                {currentMessages.map((message, index) => {
                  const isUser = message.role === "user";
                  const showHeader = index === 0 || currentMessages[index - 1].role !== message.role;
                  return (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1, transition: { duration: 0.1 } }}
                      className={`hover:bg-[#2E3035] pl-[72px] pr-12 py-1.5 group ${showHeader ? 'mt-[17px]' : ''} relative ${isUser ? 'bg-[#2B2D31]/10' : ''}`}
                    >
                      <div className="flex gap-4 items-start w-full relative">
                        {showHeader ? (
                          <div className={`absolute -left-14 top-0 w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-lg ${isUser ? 'bg-gradient-to-br from-[#7289da] to-[#5865F2]' : 'bg-gradient-to-br from-[#10A37F] to-[#128669] shadow-[0_0_15px_rgba(16,163,127,0.4)]'}`}>
                            {isUser ? <User className="w-5 h-5 text-white" /> : <Bot className="w-6 h-6 text-white drop-shadow-md" />}
                          </div>
                        ) : (
                           <div className="absolute -left-[60px] top-[7px] w-[50px] shrink-0 text-right select-none opacity-0 group-hover:opacity-100 font-medium text-[11px] text-[#949BA4]">
                             {/* Timestamp mockup */}
                             {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                           </div>
                        )}
                        <div className="flex-1 min-w-0">
                           {showHeader && (
                             <div className="flex items-baseline gap-2 mb-1">
                                <span className={`font-medium text-[16px] hover:underline cursor-pointer ${isUser ? 'text-white' : 'text-[#00A8FC]'}`}>
                                  {isUser ? 'You' : selectedModel?.name || "Assistant"}
                                </span>
                                {!isUser && <span className="text-[10px] bg-[#5865F2] text-white px-1.5 rounded tracking-wide font-bold flex items-center h-[16px] -mt-[1px] font-sans">APP</span>}
                                <span className="text-xs text-[#949BA4] font-medium ml-1">Today at {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                             </div>
                           )}
                           
                           <div className="text-[15px] leading-[1.375rem] text-[#DBDEE1]">
                              {/* Attachments */}
                              {((message.images && message.images.length > 0) || (message.videos && message.videos.length > 0) || (message.files && message.files.length > 0)) && (
                                <div className="flex flex-wrap gap-3 my-2">
                                  {message.images?.map((img, i) => (
                                    <img 
                                      key={`msg-img-${i}`} 
                                      src={img} 
                                      alt="Uploaded" 
                                      className="max-w-[400px] h-auto max-h-80 rounded-lg object-contain bg-[#1E1F22] border border-[#111214] shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                                      onClick={() => setZoomedImage(img)}
                                    />
                                  ))}
                                  {message.videos?.map((vid, i) => (
                                    <video 
                                      key={`msg-vid-${i}`} 
                                      src={vid} 
                                      controls
                                      className="max-w-[400px] h-auto max-h-80 rounded-lg object-contain bg-[#1E1F22] border border-[#111214] shadow-sm"
                                    />
                                  ))}
                                  {message.files?.map((file, i) => (
                                    <div 
                                      key={`msg-file-${i}`} 
                                      className="flex items-center justify-between gap-3 bg-[#2B2D31] border border-[#1E1F22] rounded-lg max-w-sm w-full transition-colors hover:border-[#4E5058] overflow-hidden pr-2"
                                    >
                                      <div 
                                        className="flex items-center gap-3 p-3 flex-1 cursor-pointer hover:bg-[#35373C]"
                                        onClick={() => setPreviewTarget({ filename: file.name, url: file.url, content: file.text, type: file.type })}
                                      >
                                        <div className="bg-[#1E1F22] p-2.5 rounded text-[#DBDEE1]">
                                          {file.type === "pdf" ? <FileText className="w-6 h-6 text-[#ED4245]" /> : <FileText className="w-6 h-6 text-[#00A8FC]" />}
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <span className="truncate text-[#00A8FC] font-medium text-[14px]">{file.name}</span>
                                            <span className="text-[#949BA4] text-[12px]">{file.type === 'pdf' ? 'PDF Document' : 'File'}</span>
                                        </div>
                                      </div>
                                      <a 
                                        href={file.url} 
                                        download 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="p-2 text-[#949BA4] hover:text-[#DBDEE1] transition-colors rounded-md hover:bg-[#1E1F22]"
                                        title="Download File"
                                      >
                                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                                      </a>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {/* Markdown */}
                              <div className="markdown-body discord-markdown">
                                <ReactMarkdown 
                                  remarkPlugins={[remarkGfm, remarkMath]}
                                  rehypePlugins={[rehypeKatex]}
                                  components={renderMarkdownComponents}
                                >
                                  {message.content}
                                </ReactMarkdown>
                              </div>
                           </div>
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
              
              {isLoading && (
                <div className="mt-[17px] pl-[72px] relative mb-2">
                   <div className="flex items-center gap-4">
                      <div className="absolute -left-14 top-0 w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-[#10A37F]">
                         <Bot className="w-6 h-6 text-white" />
                      </div>
                      <div className="flex gap-1.5 items-center px-0 py-2 w-fit">
                         <span className="w-2.5 h-2.5 bg-[#80848E] rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                         <span className="w-2.5 h-2.5 bg-[#80848E] rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                         <span className="w-2.5 h-2.5 bg-[#80848E] rounded-full animate-bounce"></span>
                      </div>
                   </div>
                </div>
              )}
            </div>

            {/* Provide empty space at bottom */}
            <div className="h-4 pointer-events-none shrink-0"></div>
          </div>

          {/* Input Area */}
          <div className="px-4 pb-6 pt-0 shrink-0">
            {suggestedModels.length > 0 && selectedModel && !suggestedModels.find(m => m.id === selectedModel.id) && (
              <div className="px-1 mb-2 flex items-center gap-2 flex-wrap text-sm">
                <Sparkles className="w-3.5 h-3.5 text-[#5865F2]" />
                <span className="text-[#949BA4] font-medium text-xs uppercase tracking-wider">Suggested for this task:</span>
                {suggestedModels.map((model, i) => (
                  <button 
                    key={i} 
                    onClick={() => setSelectedModelId(model.id)}
                    className="px-2 py-[3px] text-xs bg-[#2B2D31] text-[#DBDEE1] hover:bg-[#5865F2] hover:text-white rounded-full transition-colors font-medium border border-[#1E1F22] shadow-sm flex items-center gap-1"
                  >
                     {model.name}
                  </button>
                ))}
              </div>
            )}
            <div className="bg-[#383A40] rounded-lg flex flex-col relative focus-within:ring-1 border border-transparent focus-within:border-transparent focus-within:ring-[#5865F2] transition-shadow">
              {/* Attachments Preview */}
              {(pendingImages.length > 0 || pendingVideos.length > 0 || pendingFiles.length > 0) && (
                <div className="flex gap-4 p-4 pb-0 mb-3 overflow-x-auto custom-scrollbar">
                  {pendingImages.map((img, i) => (
                    <div key={`img-${i}`} className="relative inline-block group shrink-0 bg-[#2B2D31] p-1.5 rounded-lg border border-[#1E1F22]">
                       <div className="w-[160px] h-[160px] bg-[#1E1F22] flex items-center justify-center rounded overflow-hidden relative">
                         <img src={img} className="max-w-full max-h-full object-contain" />
                       </div>
                      <button 
                        onClick={() => setPendingImages(prev => prev.filter((_, idx) => idx !== i))}
                        className="absolute -top-2 -right-2 bg-[#2B2D31] hover:bg-[#ED4245] text-[#DBDEE1] hover:text-white rounded-full p-1.5 shadow-md border border-[#1E1F22] transition-transform transform scale-0 group-hover:scale-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {pendingVideos.map((vid, i) => (
                    <div key={`vid-${i}`} className="relative inline-block group shrink-0 bg-[#2B2D31] p-1.5 rounded-lg border border-[#1E1F22]">
                       <div className="w-[160px] h-[160px] bg-[#1E1F22] flex items-center justify-center rounded overflow-hidden relative">
                         <video src={vid} className="max-w-full max-h-full object-contain" controls />
                       </div>
                      <button 
                        onClick={() => setPendingVideos(prev => prev.filter((_, idx) => idx !== i))}
                        className="absolute -top-2 -right-2 bg-[#2B2D31] hover:bg-[#ED4245] text-[#DBDEE1] hover:text-white rounded-full p-1.5 shadow-md border border-[#1E1F22] transition-transform transform scale-0 group-hover:scale-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {pendingFiles.map((file, i) => (
                    <div key={`file-${i}`} className="relative flex items-center gap-3 bg-[#2B2D31] p-3 rounded-lg shrink-0 group w-[220px] border border-[#1E1F22]">
                        <div className="bg-[#1E1F22] p-2 rounded">
                            <FileText className="w-6 h-6 text-[#DBDEE1]" />
                        </div>
                        <div className="flex flex-col min-w-0">
                           <span className="text-[14px] text-white font-medium truncate w-full block">{file.name}</span>
                           <span className="text-[12px] text-[#949BA4] truncate w-full block">{file.type}</span>
                        </div>
                      <button 
                        onClick={() => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))}
                        className="absolute -top-2 -right-2 bg-[#2B2D31] hover:bg-[#ED4245] text-[#DBDEE1] hover:text-white rounded-full p-1.5 shadow border border-[#1E1F22] transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center pr-2 py-0.5">
                <div className="pl-3 py-3 self-end">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isFileUploading}
                    className={`w-6 h-6 rounded-full bg-[#B5BAC1] hover:bg-[#DBDEE1] flex items-center justify-center transition-colors flex-shrink-0 mb-[1px] ${isFileUploading ? 'opacity-50 cursor-wait' : ''}`}
                    title="Upload a file"
                  >
                    {isFileUploading ? <Loader2 className="w-3 h-3 text-[#383A40] animate-spin" /> : <Plus className="w-4 h-4 text-[#383A40]" />}
                  </button>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  multiple 
                  className="hidden" 
                  onChange={handleFileSelect} 
                />
                
                <textarea
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                      e.currentTarget.style.height = 'auto';
                    }
                  }}
                  placeholder={`Message @${selectedModel?.name || "AI"}`}
                  className="w-full bg-transparent text-[#DBDEE1] placeholder-[#5C5E66] px-4 py-[11px] outline-none text-[15px] resize-none overflow-hidden min-h-[44px] max-h-[200px]"
                  style={{ height: '44px' }}
                  rows={1}
                />
                <div className="pr-3 py-2 self-end mb-0.5 flex items-center gap-2">
                  <select
                    value={outputLength}
                    onChange={(e) => setOutputLength(e.target.value)}
                    className="bg-transparent text-[#DBDEE1] text-xs font-medium outline-none cursor-pointer border border-[#383A40] hover:border-[#5865F2] rounded px-2 py-1.5 transition-colors"
                  >
                    {LENGTH_OPTIONS.map(opt => (
                      <option key={opt.id} value={opt.id} className="bg-[#313338] text-[#DBDEE1]">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={outputFormat}
                    onChange={(e) => setOutputFormat(e.target.value)}
                    className="bg-transparent text-[#DBDEE1] text-xs font-medium outline-none cursor-pointer border border-[#383A40] hover:border-[#5865F2] rounded px-2 py-1.5 transition-colors"
                  >
                    {FORMAT_OPTIONS.map(opt => (
                      <option key={opt.id} value={opt.id} className="bg-[#313338] text-[#DBDEE1]">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button 
                    onClick={(e) => {
                      handleSend();
                      const textarea = e.currentTarget.parentElement?.previousElementSibling as HTMLTextAreaElement;
                      if (textarea) textarea.style.height = 'auto';
                    }}
                    disabled={(!input.trim() && pendingImages.length === 0 && pendingVideos.length === 0 && pendingFiles.length === 0) || isLoading || isFileUploading}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors flex-shrink-0 ${(!input.trim() && pendingImages.length === 0 && pendingVideos.length === 0 && pendingFiles.length === 0) || isLoading || isFileUploading ? 'bg-transparent text-[#4E5058] cursor-not-allowed' : 'bg-[#5865F2] text-white hover:bg-[#4752C4] shadow-sm'}`}
                    title="Send Message"
                  >
                    <Send className="w-4 h-4 mt-[1px] ml-[1px]" />
                  </button>
                </div>
              </div>
            </div>
            {/* Small info text */}
            <div className="flex justify-between px-1 mt-1 shrink-0 h-4">
               <div className="text-[11px] text-[#949BA4]">
                 {isFileUploading && (
                   <span className="flex items-center text-[#DBDEE1]">
                     <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                     Uploading {pendingFiles.length > 0 ? "more files" : "file"}...
                   </span>
                 )}
               </div>
               <div className="text-[11px] font-mono text-[#949BA4] font-bold">
                  {isLoading ? 'WORKING...' : 'READY'}
               </div>
            </div>
          </div>

        </main>

        <AnimatePresence>
          {previewTarget && (
            <motion.aside 
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: previewWidth, opacity: 1 }}
              transition={isResizingPreview ? { width: { duration: 0 } } : { type: "spring", bounce: 0, duration: 0.3 }}
              exit={{ width: 0, opacity: 0 }}
              className="bg-[#2B2D31] flex flex-col shrink-0 overflow-visible relative z-10 border-l border-[#1E1F22]"
            >
              {/* Resize Handle */}
              <div 
                className="absolute -left-[3px] top-0 bottom-0 w-[6px] cursor-col-resize hover:bg-[#5865F2] active:bg-[#5865F2] transition-colors z-20"
                onMouseDown={handlePreviewResizeMouseDown}
              />
              <div className="h-12 border-b border-[#1E1F22] flex items-center justify-between px-4 shrink-0 bg-[#313338]">
                <h3 className="font-bold text-[15px] truncate text-white max-w-[300px]">Preview: {previewTarget.filename}</h3>
                <div className="flex items-center gap-2">
                  {(previewTarget.filename.toLowerCase().match(/\.(tex|latex|md|markdown)$/) || previewTarget.language === 'latex' || previewTarget.language === 'tex' || previewTarget.language === 'markdown') && (
                    <button 
                      onClick={handleExportPdf}
                      className="text-[#949BA4] hover:text-[#DBDEE1] transition-colors p-1 flex items-center gap-1.5 text-xs font-medium border border-[#1E1F22] hover:border-[#5865F2] rounded px-2"
                      title="Export to PDF"
                    >
                      Export PDF
                    </button>
                  )}
                  {previewTarget.url && (
                    <a 
                      href={previewTarget.url}
                      download={previewTarget.filename}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#949BA4] hover:text-[#DBDEE1] transition-colors p-1"
                      title="Download File"
                    >
                      <Download className="w-5 h-5" />
                    </a>
                  )}
                  <button 
                    onClick={() => setPreviewTarget(null)}
                    className="text-[#949BA4] hover:text-[#DBDEE1] transition-colors p-1"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto bg-[#1E1F22] p-4 custom-scrollbar">
                {previewTarget.url && previewTarget.filename.toLowerCase().endsWith('.pdf') ? (
                  <iframe src={previewTarget.url} className="w-full h-full rounded-lg border border-[#111214]" />
                ) : previewTarget.filename.toLowerCase().match(/\.(csv|xlsx?)$/) ? (
                   <div className="bg-[#2B2D31] rounded-lg p-0 border border-[#111214] shadow-sm h-full overflow-hidden">
                     <CsvPreview content={previewTarget.content} url={previewTarget.url} />
                   </div>
                ) : previewTarget.content ? (
                  <>
                     {previewTarget.filename.toLowerCase().match(/\.(tex|latex)$/) || previewTarget.language === 'latex' || previewTarget.language === 'tex' ? (
                       <div className="bg-[#E4E5E8] rounded-lg border border-[#111214] shadow-sm h-full overflow-auto flex justify-center py-8">
                         <div className="max-w-4xl w-full">
                           <LatexPreview content={previewTarget.content} />
                         </div>
                       </div>
                     ) : previewTarget.filename.toLowerCase().match(/\.(md|markdown)$/) || previewTarget.language === 'markdown' ? (
                       <div className="markdown-body discord-markdown document-preview mx-auto max-w-4xl">
                          <ReactMarkdown 
                            remarkPlugins={[remarkGfm, remarkMath]} 
                            rehypePlugins={[rehypeKatex]} 
                            components={renderMarkdownComponents}
                          >
                            {previewTarget.content}
                          </ReactMarkdown>
                       </div>
                     ) : (
                       <div className="bg-[#2B2D31] rounded-lg p-4 border border-[#111214] shadow-sm h-full overflow-auto">
                         <pre className="text-sm font-mono text-[#DBDEE1] whitespace-pre-wrap">
                           {previewTarget.content}
                         </pre>
                       </div>
                     )}
                  </>
                ) : (
                  <div className="flex items-center justify-center h-full text-[#949BA4]">
                    No preview available for this file type.
                  </div>
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
        </div>

        <AnimatePresence>
          {isManageModelsOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
              onClick={() => setIsManageModelsOpen(false)}
            >
              <motion.div 
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.95 }}
                className="bg-[#313338] rounded-xl shadow-xl w-full max-w-md overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between p-4 border-b border-[#1E1F22]">
                  <h2 className="text-xl font-bold text-white">Manage Models</h2>
                  <button onClick={() => setIsManageModelsOpen(false)} className="text-[#949BA4] hover:text-[#DBDEE1]">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="p-4 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-[#80848E] uppercase mb-2">Add Custom Model</h3>
                    <div className="flex gap-2">
                       <input 
                         type="text" 
                         placeholder="Model ID (e.g. minion-v1)" 
                         value={newModelConfig.id}
                         onChange={e => setNewModelConfig(prev => ({ ...prev, id: e.target.value.replace(/[^a-zA-Z0-9.\-_]/g, '') }))}
                         className="flex-1 bg-[#1E1F22] rounded px-3 py-2 text-sm text-[#DBDEE1] outline-none border border-[#111214] focus:border-[#5865F2]"
                       />
                       <input 
                         type="text" 
                         placeholder="Model Name" 
                         value={newModelConfig.name}
                         onChange={e => setNewModelConfig(prev => ({ ...prev, name: e.target.value }))}
                         className="flex-1 bg-[#1E1F22] rounded px-3 py-2 text-sm text-[#DBDEE1] outline-none border border-[#111214] focus:border-[#5865F2]"
                       />
                    </div>
                    <button 
                      onClick={() => {
                        if (newModelConfig.id && newModelConfig.name) {
                          setCustomModels(prev => [...prev.filter(m => m.id !== newModelConfig.id), {
                            id: newModelConfig.id,
                            name: newModelConfig.name,
                            inputCost: "0.0",
                            outputCost: "0.0",
                            provider: "Custom"
                          }]);
                          setNewModelConfig({ id: "", name: "" });
                        }
                      }}
                      disabled={!newModelConfig.id || !newModelConfig.name}
                      className="mt-2 w-full bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded py-2 text-sm transition-colors"
                    >
                      Add Model
                    </button>
                  </div>

                  {customModels.length > 0 && (
                    <div className="pt-2">
                      <h3 className="text-sm font-semibold text-[#80848E] uppercase mb-2">Custom Models</h3>
                      <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                        {customModels.map(model => (
                          <div key={model.id} className="flex items-center justify-between bg-[#1E1F22] p-2 rounded border border-[#111214]">
                             <div>
                               <div className="font-medium text-[14px] text-white whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px]" title={model.name}>{model.name}</div>
                               <div className="text-[12px] text-[#949BA4] font-mono whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px]" title={model.id}>{model.id}</div>
                             </div>
                             <button
                               onClick={() => setCustomModels(prev => prev.filter(m => m.id !== model.id))}
                               className="text-[#ED6A5E] hover:text-red-400 p-1"
                             >
                                <Trash2 className="w-4 h-4" />
                             </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
          
          {groupToDelete && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
              onClick={() => setGroupToDelete(null)}
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-[#313338] w-full max-w-md rounded-lg shadow-xl overflow-hidden border border-[#1E1F22]"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-5">
                  <h2 className="text-xl font-bold text-white mb-2">Delete Group</h2>
                  <p className="text-[#DBDEE1] text-[15px] mb-6">
                    Are you sure you want to delete this group? All chats inside this group will be permanently deleted. This action cannot be undone.
                  </p>
                  <div className="flex justify-end gap-3">
                    <button 
                      onClick={() => setGroupToDelete(null)}
                      className="px-4 py-2 text-[#DBDEE1] hover:underline font-medium text-sm transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={confirmDeleteGroup}
                      className="bg-[#ED4245] hover:bg-[#C93335] text-white px-5 py-2 rounded font-medium text-sm transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}

          {isCreateGroupOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
              onClick={() => setIsCreateGroupOpen(false)}
            >
              <motion.div 
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.95 }}
                className="bg-[#313338] rounded-xl shadow-xl w-full max-w-sm overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between p-4 border-b border-[#1E1F22]">
                  <h2 className="text-xl font-bold text-white">Create New Group</h2>
                  <button onClick={() => setIsCreateGroupOpen(false)} className="text-[#949BA4] hover:text-[#DBDEE1]">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="p-4 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-[#80848E] uppercase mb-2">Group Name</h3>
                    <input 
                      type="text" 
                      placeholder="e.g. Work, Study, Projects" 
                      value={newGroupName}
                      onChange={e => setNewGroupName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newGroupName.trim()) {
                           const colors = ['bg-[#5865F2]', 'bg-[#ED6A5E]', 'bg-[#F4BF4F]', 'bg-[#61C554]', 'bg-[#EB459E]'];
                           const color = colors[Math.floor(Math.random() * colors.length)];
                           const newGroup = { id: Date.now().toString(), name: newGroupName.trim(), color };
                           setGroups(prev => [...prev, newGroup]);
                           handleGroupSelect(newGroup.id);
                           setNewGroupName("");
                           setIsCreateGroupOpen(false);
                        }
                      }}
                      autoFocus
                      className="w-full bg-[#1E1F22] rounded px-3 py-2 text-sm text-[#DBDEE1] outline-none border border-[#111214] focus:border-[#5865F2]"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button 
                      onClick={() => setIsCreateGroupOpen(false)}
                      className="text-[#DBDEE1] hover:text-white px-4 py-2 rounded text-sm font-medium transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={() => {
                        if (newGroupName.trim()) {
                          const colors = ['bg-[#5865F2]', 'bg-[#ED6A5E]', 'bg-[#F4BF4F]', 'bg-[#61C554]', 'bg-[#EB459E]'];
                          const color = colors[Math.floor(Math.random() * colors.length)];
                          const newGroup = { id: Date.now().toString(), name: newGroupName.trim(), color };
                          setGroups(prev => [...prev, newGroup]);
                          handleGroupSelect(newGroup.id);
                          setNewGroupName("");
                          setIsCreateGroupOpen(false);
                        }
                      }}
                      disabled={!newGroupName.trim()}
                      className="bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded py-2 px-4 text-sm transition-colors"
                    >
                      Create
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showSettings && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
              onClick={() => setShowSettings(false)}
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-[#313338] rounded-xl shadow-2xl w-full max-w-md overflow-hidden relative"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                      <Settings className="w-5 h-5 text-[#949BA4]" />
                      Settings
                    </h2>
                    <button 
                      onClick={() => setShowSettings(false)}
                      className="text-[#949BA4] hover:text-[#DBDEE1] transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="space-y-4 mb-6">
                    <div>
                      <label className="block text-xs font-bold text-[#b5bac1] uppercase mb-2">Developer Name</label>
                      <input 
                        type="text" 
                        value={developerName}
                        onChange={e => {
                          setDeveloperName(e.target.value);
                          saveSettingsToServer({ developerName: e.target.value });
                        }}
                        className="w-full bg-[#1e1f22] border border-[#1e1f22] rounded py-2.5 px-3 text-[#DBDEE1] text-sm focus:outline-none focus:border-[#5865F2] transition-colors"
                        placeholder="Developer"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#b5bac1] uppercase mb-2">KNP LAB AI API Key <span className="text-red-500">*</span></label>
                      <input 
                        type="password" 
                        value={apiKey}
                        onChange={e => {
                          setApiKey(e.target.value);
                          saveSettingsToServer({ apiKey: e.target.value });
                        }}
                        className="w-full bg-[#1e1f22] border border-[#1e1f22] rounded py-2.5 px-3 text-[#DBDEE1] text-sm focus:outline-none focus:border-[#5865F2] transition-colors"
                        placeholder="sk-..."
                      />
                      <p className="text-xs text-[#949BA4] mt-2 leading-relaxed">
                        Your API key is stored locally in your browser and used to authenticate your requests to the KNP LAB AI API.
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2 border-t border-[#1e1f22]/50 mt-4 h-[55px] items-center">
                    <button 
                      onClick={() => setShowSettings(false)}
                      className="bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium rounded py-2 px-6 text-sm transition-colors"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {zoomedImage && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setZoomedImage(null)}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm cursor-zoom-out"
            >
              <div 
                className="relative max-w-[95vw] max-h-[95vh] flex items-center justify-center"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => setZoomedImage(null)}
                  className="absolute -top-10 right-0 sm:-right-10 text-white/70 hover:text-white transition-colors bg-black/20 hover:bg-black/40 rounded-full p-2"
                >
                  <X className="w-6 h-6" />
                </button>
                <img 
                  src={zoomedImage} 
                  alt="Zoomed full size" 
                  className="max-w-full max-h-[90vh] object-contain rounded drop-shadow-2xl"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
      </DragDropContext>
    </div>
  );
}

