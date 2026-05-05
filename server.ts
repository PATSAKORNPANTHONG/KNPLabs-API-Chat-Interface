import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs/promises";
import multer from "multer";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
const xlsx = require("xlsx");
const { mdToPdf } = require("md-to-pdf");

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  const chatsDir = path.join(process.cwd(), "data", "chats");
  const oldChatsFile = path.join(process.cwd(), "data", "chats.json");
  const uploadDir = path.join(process.cwd(), "data", "uploads");

  // Ensure chats dir exists and migrate old data
  try {
    await fs.access(chatsDir);
  } catch {
    await fs.mkdir(chatsDir, { recursive: true });
  }

  try {
    await fs.access(uploadDir);
  } catch {
    await fs.mkdir(uploadDir, { recursive: true });
  }

  // Migrate old chats.json to individual folders
  try {
    const oldData = await fs.readFile(oldChatsFile, "utf-8");
    const oldChats = JSON.parse(oldData);
    if (Array.isArray(oldChats)) {
      console.log("Migrating old chats.json to folders...");
      for (const chat of oldChats) {
        if (chat && chat.id) {
          const chatFolder = path.join(chatsDir, chat.id);
          await fs.mkdir(chatFolder, { recursive: true });
          await fs.writeFile(path.join(chatFolder, "chat.json"), JSON.stringify(chat, null, 2), "utf-8");
        }
      }
      await fs.rename(oldChatsFile, oldChatsFile + ".bak");
      console.log("Migration complete.");
    }
  } catch (error: any) {
    // If file doesn't exist or isn't parseable, safely ignore
  }

  // Migrate old flat {id}.json to {id}/chat.json folders
  try {
    const entries = await fs.readdir(chatsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        const id = entry.name.replace(".json", "");
        const folder = path.join(chatsDir, id);
        await fs.mkdir(folder, { recursive: true });
        await fs.rename(path.join(chatsDir, entry.name), path.join(folder, "chat.json"));
      }
    }
  } catch (e) {
    console.error("Failed to migrate flat json files", e);
  }

  app.use("/uploads", express.static(uploadDir));

  // Serve file attachments dynamically from chat subfolders
  app.get("/api/chats/:chatId/files/:filename", (req, res) => {
    res.sendFile(path.join(chatsDir, req.params.chatId, "files", req.params.filename));
  });

  // Serve image attachments dynamically from chat subfolders
  app.get("/api/chats/:chatId/images/:filename", (req, res) => {
    res.sendFile(path.join(chatsDir, req.params.chatId, "images", req.params.filename));
  });
  app.get("/api/chats/:chatId/videos/:filename", (req, res) => {
    res.sendFile(path.join(chatsDir, req.params.chatId, "videos", req.params.filename));
  });

  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      const chatId = req.params.chatId;
      if (chatId && chatId !== "undefined" && chatId !== "null") {
        const isImage = file.mimetype.startsWith('image/');
        const isVideo = file.mimetype.startsWith('video/');
        const subFolder = isImage ? "images" : (isVideo ? "videos" : "files");
        const dest = path.join(chatsDir, chatId, subFolder);
        try {
          await fs.mkdir(dest, { recursive: true });
          cb(null, dest);
        } catch (e: any) {
          cb(e, dest);
        }
      } else {
        cb(null, uploadDir);
      }
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    }
  });
  const upload = multer({ storage });

  const handleUpload = async (req: express.Request, res: express.Response): Promise<any> => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const isPdf = req.file.mimetype.includes("pdf") || req.file.originalname.toLowerCase().endsWith(".pdf");
      let text = "";

      if (isPdf) {
        try {
          const dataBuffer = await fs.readFile(req.file.path);
          const data = await pdfParse(dataBuffer);
          text = data.text;
          if (text && text.length > 50000) {
            text = text.substring(0, 50000) + "\n...[truncated remainder of PDF]";
          }
        } catch (error) {
          console.error("Failed to parse PDF:", error);
          text = "[Error extracting text from PDF. The file may be scanned, encrypted, or corrupted.]";
        }
        
        return res.json({
          url: req.params.chatId ? `/api/chats/${req.params.chatId}/files/${req.file.filename}` : `/uploads/${req.file.filename}`,
          name: req.file.originalname,
          type: "pdf",
          text
        });
      }

      const isText = req.file.mimetype.includes("text") || 
                     req.file.mimetype.includes("json") || 
                     req.file.originalname.match(/\.(txt|csv|json|md|mdx|js|ts|jsx|tsx|html|css|py|java|c|cpp|h|cs|go|rs|php|rb|swift|sql|sh|yml|yaml|xml|ini|cfg|conf|bat|ps1)$/i);
      if (isText) {
         try {
            text = await fs.readFile(req.file.path, "utf-8");
            if (text.length > 50000) text = text.substring(0, 50000) + "\n...[truncated]";
         } catch (err) {
            console.error("Failed to read text file:", err);
         }
      }

      const isImage = req.file.mimetype.startsWith('image/');
      const isVideo = req.file.mimetype.startsWith('video/');
      const subFolder = isImage ? "images" : (isVideo ? "videos" : "files");

      return res.json({
        url: req.params.chatId ? `/api/chats/${req.params.chatId}/${subFolder}/${req.file.filename}` : `/uploads/${req.file.filename}`,
        name: req.file.originalname,
        type: isVideo ? "video" : (isImage ? "image" : "file"),
        text
      });
    } catch (err) {
      console.error("Upload route error:", err);
      return res.status(500).json({ error: "Internal server error during file upload" });
    }
  };

  app.post("/api/upload", upload.single("file"), handleUpload);
  app.post("/api/chats/:chatId/upload", upload.single("file"), handleUpload);

  // Get saved chats from server local files (Summaries only)
  app.get("/api/chats", async (req, res) => {
    try {
      const entries = await fs.readdir(chatsDir, { withFileTypes: true });
      const chats = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const data = await fs.readFile(path.join(chatsDir, entry.name, "chat.json"), "utf-8");
            const chat = JSON.parse(data);
            // Omit messages for summary
            const { messages, ...summary } = chat;
            chats.push(summary);
          } catch (e) {
            // ignore empty/corrupted folders
          }
        }
      }
      // Sort by updatedAt descending
      chats.sort((a, b) => b.updatedAt - a.updatedAt);
      res.json(chats);
    } catch (error: any) {
      if (error.code === "ENOENT") {
        res.json([]);
      } else {
        res.status(500).json({ error: "Failed to read chats" });
      }
    }
  });

  // Get full chat details
  app.get("/api/chats/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const data = await fs.readFile(path.join(chatsDir, id, "chat.json"), "utf-8");
      res.json(JSON.parse(data));
    } catch (error: any) {
      if (error.code === "ENOENT") {
        res.status(404).json({ error: "Chat not found" });
      } else {
        res.status(500).json({ error: "Failed to read chat" });
      }
    }
  });

  // Save a single chat to server local file
  app.post("/api/chats", async (req, res) => {
    try {
      const chat = req.body;
      if (!chat || !chat.id) {
        return res.status(400).json({ error: "Invalid chat data" });
      }
       
      const chatFolder = path.join(chatsDir, `${chat.id}`);
      await fs.mkdir(chatFolder, { recursive: true });
      const chatFile = path.join(chatFolder, "chat.json");
      await fs.writeFile(chatFile, JSON.stringify(chat, null, 2), "utf-8");
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to save chat:", error);
      res.status(500).json({ error: "Failed to save chat" });
    }
  });

  // Delete a chat
  app.delete("/api/chats/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await fs.rm(path.join(chatsDir, id), { recursive: true, force: true });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Failed to delete chat:", error);
      res.status(500).json({ error: "Failed to delete chat" });
    }
  });

  const settingsFile = path.join(process.cwd(), "data", "settings.json");

  // Get Settings
  app.get("/api/settings", async (req, res) => {
    try {
      const data = await fs.readFile(settingsFile, "utf-8");
      res.json(JSON.parse(data));
    } catch (e: any) {
       res.json({});
    }
  });

  // Save Settings
  app.post("/api/settings", async (req, res) => {
    try {
       await fs.mkdir(path.dirname(settingsFile), { recursive: true });
       await fs.writeFile(settingsFile, JSON.stringify(req.body, null, 2), "utf-8");
       res.json({ success: true });
    } catch (e) {
       console.error("Failed to save settings:", e);
       res.status(500).json({ error: "Failed to save settings" });
    }
  });

  // API Proxy Route
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, model = "claude-sonnet-4-6" } = req.body;
      const apiKey = req.headers["x-knp-api-key"] || process.env.KNP_API_KEY;

      if (!apiKey) {
        return res.status(401).json({ error: "API key is required. Please set it in Settings." });
      }

      if (!messages) {
        return res.status(400).json({ error: "Messages are required" });
      }

      const knpClient = new OpenAI({
        apiKey: apiKey as string,
        baseURL: "https://api.knplabai.com/ai/v1",
        defaultHeaders: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }
      });

      console.log(`Sending request to KNP Lab AI with model: ${model}`);

      const processedMessages = [];
      for (const m of messages) {
        const msg = { ...m };
        if (Array.isArray(msg.content)) {
          for (const item of msg.content) {
            if (item.type === 'image_url' && item.image_url && item.image_url.url && item.image_url.url.startsWith('/')) {
              // Convert local URL back to file path and read as base64
              let localPath = '';
              if (item.image_url.url.startsWith('/api/chats/')) {
                // /api/chats/:chatId/images/:filename
                const parts = item.image_url.url.split('/');
                const chatId = parts[3];
                const subFolder = parts[4];
                const filename = parts[5];
                localPath = path.join(chatsDir, chatId, subFolder, filename);
              } else if (item.image_url.url.startsWith('/uploads/')) {
                const filename = item.image_url.url.split('/')[2];
                localPath = path.join(uploadDir, filename);
              }
              
              if (localPath) {
                try {
                  const data = await fs.readFile(localPath);
                  const ext = path.extname(localPath).substring(1) || 'jpeg';
                  const base64 = data.toString('base64');
                  item.image_url.url = `data:image/${ext};base64,${base64}`;
                } catch (e) {
                  console.error("Failed to read local image for API:", e);
                }
              }
            }
          }
        }
        processedMessages.push(msg);
      }

      const lastMsg = processedMessages[processedMessages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
          const sysPrompt = "\n\n(System instructions: The user highly prefers colorful, beautifully styled HTML/CSS visualizations over Mermaid. ALWAYS output interactive HTML/CSS using an ```html codeblock for flowcharts, diagrams, process flows, structural diagrams, or any visual aids. Include internal <style> tags to make it beautiful (gradients, modern spacing, flexbox, etc). If the user asks for a file, document, spreadsheet, Excel file, or export, YOU MUST DIRECTLY GENERATE THE CONTENT in a code block. For spreadsheets/Excel, ALWAYS generate CSV files using the format: ```csv:filename.csv\n...content...\n```. For documents, PDFs, or LaTeX requests, ALWAYS generate Markdown (```markdown:filename.md) using LaTeX equations with $$ and $ delimiters. DO NOT generate full \\documentclass LaTeX files, ONLY Markdown, because the system renders Markdown into a beautiful PDF-like A4 document automatically. CRITICAL: YOUR ENTIRE RESPONSE MUST BE JUST THE CODEBLOCK. DO NOT add conversational fillers. DO NOT explain what format you are using. DO NOT mention that you cannot create .xlsx or .pdf. DO NOT say 'Here is your file...'. Do not apologize, do not explain. Just output the code block alone. Clean DTDL CSV data to purely be the base IDs!)";
          if (typeof lastMsg.content === 'string') {
              lastMsg.content += sysPrompt;
          } else if (Array.isArray(lastMsg.content)) {
              const txtItem = lastMsg.content.find((c: any) => c.type === 'text');
              if (txtItem) txtItem.text += sysPrompt;
          }
      }

      let response = await knpClient.chat.completions.create({
        model,
        messages: processedMessages,
        stream: false,
      });

      const chatId = req.body.chatId;
      if (chatId && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content) {
        let content = response.choices[0].message.content;
        let hasChanges = false;
        
        // Handle Base64 Data URLs
        const base64Regex = /data:image\/([a-zA-Z]*);base64,([^\s"'\)]+)/g;
        let match;
        while ((match = base64Regex.exec(content)) !== null) {
          hasChanges = true;
          const ext = match[1] || 'png';
          const base64Data = match[2];
          const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
          const destDir = path.join(chatsDir, chatId, "images");
          const destFile = path.join(destDir, filename);
          
          try {
            await fs.mkdir(destDir, { recursive: true });
            await fs.writeFile(destFile, Buffer.from(base64Data, 'base64'));
            const localUrl = `/api/chats/${chatId}/images/${filename}`;
            content = content.replace(match[0], localUrl);
          } catch (e) {
            console.error("Failed to save generated image:", e);
          }
        }
        
        // Handle Standard Markdown URLs
        const markdownUrlRegex = /!\[([^\]]*)\]\((https?:\/\/[^\s\)]+)\)/g;
        let mdMatch;
        let newContent = content;
        
        // We need to do this sequentially due to async fetching
        const fetches = [];
        while ((mdMatch = markdownUrlRegex.exec(content)) !== null) {
          const fullMatch = mdMatch[0];
          const altText = mdMatch[1];
          const url = mdMatch[2];
          
          fetches.push(async () => {
             try {
                const imgRes = await fetch(url);
                if (!imgRes.ok) throw new Error("Status " + imgRes.status);
                const arrayBuffer = await imgRes.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                
                const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
                const ext = contentType.split('/')[1] || 'png';
                const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
                const destDir = path.join(chatsDir, chatId, "images");
                const destFile = path.join(destDir, filename);
                
                await fs.mkdir(destDir, { recursive: true });
                await fs.writeFile(destFile, buffer);
                const localUrl = `/api/chats/${chatId}/images/${filename}`;
                newContent = newContent.replace(url, localUrl);
                hasChanges = true;
             } catch (e) {
                console.error("Failed to download generated markdown image:", e);
             }
          });
        }
        
        await Promise.all(fetches.map(f => f()));
        content = newContent;
        
        // Handle CSV to Excel
        const csvRegex = /```csv:([^\s]+)\n([\s\S]*?)```/g;
        let csvMatch;
        while ((csvMatch = csvRegex.exec(content)) !== null) {
          const originalFilename = csvMatch[1];
          const filename = originalFilename.replace(/\.csv$/i, '.xlsx');
          const csvData = csvMatch[2];
          
          try {
            const workbook = xlsx.read(csvData, { type: 'string' });
            const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
            
            const destDir = path.join(chatsDir, chatId, "files");
            const safeFilename = `${Date.now()}-${filename}`;
            const destFile = path.join(destDir, safeFilename);
            
            await fs.mkdir(destDir, { recursive: true });
            await fs.writeFile(destFile, buffer);
            
            const localUrl = `/api/chats/${chatId}/files/${safeFilename}`;
            const fileLink = `\n\n📁 **[Download ${filename}](${localUrl})**\n\n`;
            content = content.replace(csvMatch[0], fileLink);
            hasChanges = true;
          } catch (e) {
            console.error("Failed to convert CSV to Excel:", e);
          }
        }

        // Handle Markdown to PDF
        const mdPdfRegex = /```markdown:([^.\s]+\.pdf)\n([\s\S]*?)```/g;
        let mdPdfMatch;
        while ((mdPdfMatch = mdPdfRegex.exec(content)) !== null) {
          const filename = mdPdfMatch[1];
          const mdData = mdPdfMatch[2];
          
          try {
            const destDir = path.join(chatsDir, chatId, "files");
            const safeFilename = `${Date.now()}-${filename}`;
            const destFile = path.join(destDir, safeFilename);
            
            await fs.mkdir(destDir, { recursive: true });
            
            await mdToPdf({ content: mdData }, { dest: destFile });
            
            const localUrl = `/api/chats/${chatId}/files/${safeFilename}`;
            const fileLink = `\n\n📄 **[Download ${filename}](${localUrl})**\n\n`;
            
            content = content.replace(mdPdfMatch[0], fileLink);
            hasChanges = true;
          } catch (e) {
            console.error("Failed to convert MD to PDF:", e);
          }
        }
        
        if (hasChanges) {
          response.choices[0].message.content = content;
        }
      }

      res.json(response);
    } catch (error: any) {
      console.error("KNP API Error:", error);
      res.status(error.status || 500).json({
        error: error.message || "An error occurred during the API request",
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
