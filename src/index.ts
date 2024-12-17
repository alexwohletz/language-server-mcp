#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import {
  createMessageConnection,
  MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node.js';
import {
  CompletionItem,
  CompletionParams,
  DidOpenTextDocumentParams,
  Hover,
  InitializeParams,
  PublishDiagnosticsParams,
  TextDocumentIdentifier,
  TextDocumentItem,
  TextDocumentSyncKind,
} from 'vscode-languageserver-protocol';
import { spawn } from 'child_process';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

interface LanguageServerConfig {
  command: string;
  args: string[];
}

interface LanguageServerInstance {
  connection: MessageConnection;
  process: ReturnType<typeof spawn>;
  workspaceRoot: string;
}

class LanguageServerMCP {
  private server: Server;
  private languageServers: Map<string, LanguageServerInstance>;
  private diagnosticsListeners: Map<string, ((params: PublishDiagnosticsParams) => void)[]>;

  constructor() {
    this.server = new Server(
      {
        name: 'language-server-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.languageServers = new Map();
    this.diagnosticsListeners = new Map();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });

    this.setupTools();
  }

  private async cleanup() {
    console.log('[cleanup] Disposing language servers...');
    for (const [id, server] of this.languageServers.entries()) {
      console.log(`[cleanup] Disposing ${id} server...`);
      server.connection.dispose();
      server.process.kill();
    }
    console.log('[cleanup] Closing MCP server...');
    await this.server.close();
  }

  private setupVirtualWorkspace(languageId: string): string {
    const workspaceRoot = join('/tmp', `mcp-${languageId}-workspace-${Date.now()}`);
    mkdirSync(workspaceRoot, { recursive: true });

    if (languageId === 'typescript') {
      // Create tsconfig.json
      const tsconfig = {
        compilerOptions: {
          target: "es2020",
          module: "commonjs",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          rootDir: "src",
          outDir: "dist"
        },
        include: ["src/**/*"],
        exclude: ["node_modules"]
      };
      writeFileSync(join(workspaceRoot, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
      mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
    }

    return workspaceRoot;
  }

  private async getOrCreateServer(languageId: string): Promise<LanguageServerInstance> {
    console.log(`[getOrCreateServer] Request for ${languageId} server`);
    
    if (this.languageServers.has(languageId)) {
      console.log(`[getOrCreateServer] Returning existing ${languageId} server`);
      return this.languageServers.get(languageId)!;
    }

    const config = this.getLanguageServerConfig(languageId);
    if (!config) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `No language server configured for ${languageId}`
      );
    }

    console.log(`[getOrCreateServer] Spawning ${languageId} server:`, config);
    const serverProcess = spawn(config.command, config.args);

    serverProcess.on('error', (error) => {
      console.error(`[${languageId} process] Error:`, error);
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[${languageId} stderr]`, data.toString());
    });

    // Create message connection
    console.log(`[getOrCreateServer] Creating message connection for ${languageId}`);
    const connection = createMessageConnection(
      new StreamMessageReader(serverProcess.stdout),
      new StreamMessageWriter(serverProcess.stdin)
    );

    // Debug logging for messages
    connection.onNotification((method, params) => {
      console.log(`[${languageId}] Notification received:`, method, params);
    });

    connection.onRequest((method, params) => {
      console.log(`[${languageId}] Request received:`, method, params);
    });

    // Set up virtual workspace
    const workspaceRoot = this.setupVirtualWorkspace(languageId);

    // Initialize connection
    console.log(`[getOrCreateServer] Starting connection for ${languageId}`);
    connection.listen();

    // Initialize language server
    console.log(`[getOrCreateServer] Initializing ${languageId} server`);
    try {
      const initializeResult = await connection.sendRequest('initialize', {
        processId: process.pid,
        rootUri: `file://${workspaceRoot}`,
        workspaceFolders: [{
          uri: `file://${workspaceRoot}`,
          name: `${languageId}-workspace`
        }],
        capabilities: {
          workspace: {
            configuration: true,
            didChangeConfiguration: { dynamicRegistration: true },
            workspaceFolders: true,
            didChangeWatchedFiles: { dynamicRegistration: true },
          },
          textDocument: {
            synchronization: {
              dynamicRegistration: true,
              willSave: true,
              willSaveWaitUntil: true,
              didSave: true
            },
            completion: {
              dynamicRegistration: true,
              completionItem: {
                snippetSupport: true,
                commitCharactersSupport: true,
                documentationFormat: ['markdown', 'plaintext'],
                deprecatedSupport: true,
                preselectSupport: true
              },
              contextSupport: true
            },
            hover: {
              dynamicRegistration: true,
              contentFormat: ['markdown', 'plaintext']
            },
            signatureHelp: {
              dynamicRegistration: true,
              signatureInformation: {
                documentationFormat: ['markdown', 'plaintext']
              }
            },
            declaration: { dynamicRegistration: true, linkSupport: true },
            definition: { dynamicRegistration: true, linkSupport: true },
            typeDefinition: { dynamicRegistration: true, linkSupport: true },
            implementation: { dynamicRegistration: true, linkSupport: true },
            references: { dynamicRegistration: true },
            documentHighlight: { dynamicRegistration: true },
            documentSymbol: { dynamicRegistration: true, hierarchicalDocumentSymbolSupport: true },
            codeAction: {
              dynamicRegistration: true,
              codeActionLiteralSupport: {
                codeActionKind: { valueSet: [] }
              }
            },
            codeLens: { dynamicRegistration: true },
            formatting: { dynamicRegistration: true },
            rangeFormatting: { dynamicRegistration: true },
            onTypeFormatting: { dynamicRegistration: true },
            rename: { dynamicRegistration: true },
            documentLink: { dynamicRegistration: true },
            colorProvider: { dynamicRegistration: true },
            foldingRange: { dynamicRegistration: true },
            publishDiagnostics: {
              relatedInformation: true,
              tagSupport: { valueSet: [1, 2] },
              versionSupport: true
            }
          }
        },
        initializationOptions: null,
      } as InitializeParams);

      console.log(`[getOrCreateServer] Initialize result for ${languageId}:`, initializeResult);
      await connection.sendNotification('initialized');
      console.log(`[getOrCreateServer] Sent initialized notification for ${languageId}`);

      // Configure server if needed
      if (languageId === 'typescript') {
        await connection.sendNotification('workspace/didChangeConfiguration', {
          settings: {
            typescript: {
              format: {
                enable: true
              },
              suggest: {
                enabled: true,
                includeCompletionsForModuleExports: true
              },
              validate: {
                enable: true
              }
            }
          }
        });
      }
    } catch (error) {
      console.error(`[getOrCreateServer] Failed to initialize ${languageId} server:`, error);
      throw error;
    }

    // Set up diagnostics handler
    connection.onNotification(
      'textDocument/publishDiagnostics',
      (params: PublishDiagnosticsParams) => {
        console.log(`[${languageId}] Received diagnostics:`, params);
        const listeners = this.diagnosticsListeners.get(params.uri) || [];
        listeners.forEach(listener => listener(params));
      }
    );

    const server = { connection, process: serverProcess, workspaceRoot };
    this.languageServers.set(languageId, server);
    console.log(`[getOrCreateServer] Successfully created ${languageId} server`);
    return server;
  }

  private getLanguageServerConfig(languageId: string): LanguageServerConfig | undefined {
    console.log(`[getLanguageServerConfig] Getting config for ${languageId}`);
    const configStr = process.env[`${languageId.toUpperCase()}_SERVER`];
    console.log(`[getLanguageServerConfig] Raw config for ${languageId}:`, configStr);
    
    if (!configStr) {
      console.log(`[getLanguageServerConfig] No config found for ${languageId}`);
      return undefined;
    }

    try {
      const config = JSON.parse(configStr);
      console.log(`[getLanguageServerConfig] Parsed config for ${languageId}:`, config);
      return config;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[getLanguageServerConfig] Invalid config for ${languageId}:`, error.message);
      } else {
        console.error(`[getLanguageServerConfig] Invalid config for ${languageId}:`, error);
      }
      return undefined;
    }
  }

  private setupTools() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_hover',
          description: 'Get hover information for a position in a document',
          inputSchema: {
            type: 'object',
            properties: {
              languageId: { type: 'string' },
              filePath: { type: 'string' },
              content: { type: 'string' },
              line: { type: 'number' },
              character: { type: 'number' },
            },
            required: ['languageId', 'filePath', 'content', 'line', 'character'],
          },
        },
        {
          name: 'get_completions',
          description: 'Get completion suggestions for a position in a document',
          inputSchema: {
            type: 'object',
            properties: {
              languageId: { type: 'string' },
              filePath: { type: 'string' },
              content: { type: 'string' },
              line: { type: 'number' },
              character: { type: 'number' },
            },
            required: ['languageId', 'filePath', 'content', 'line', 'character'],
          },
        },
        {
          name: 'get_diagnostics',
          description: 'Get diagnostic information for a document',
          inputSchema: {
            type: 'object',
            properties: {
              languageId: { type: 'string' },
              filePath: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['languageId', 'filePath', 'content'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      console.log(`[CallToolRequestSchema] Received request for ${name}:`, args);

      try {
        let result;
        switch (name) {
          case 'get_hover':
            result = await this.handleGetHover(args);
            break;
          case 'get_completions':
            result = await this.handleGetCompletions(args);
            break;
          case 'get_diagnostics':
            result = await this.handleGetDiagnostics(args);
            break;
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
        console.log(`[CallToolRequestSchema] Result for ${name}:`, result);
        return result;
      } catch (error) {
        console.error(`[CallToolRequestSchema] Error handling ${name}:`, error);
        if (error instanceof McpError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${message}`);
      }
    });
  }

  private async handleGetHover(args: any): Promise<any> {
    const { languageId, filePath, content, line, character } = args;
    console.log(`[handleGetHover] Processing request for ${languageId}`);
    
    const server = await this.getOrCreateServer(languageId);
    const uri = `file://${join(server.workspaceRoot, 'src', filePath)}`;

    // Send document to language server
    const textDocument: TextDocumentItem = {
      uri,
      languageId,
      version: 1,
      text: content,
    };

    console.log(`[handleGetHover] Sending document to server:`, textDocument);
    await server.connection.sendNotification('textDocument/didOpen', {
      textDocument,
    } as DidOpenTextDocumentParams);

    try {
      console.log(`[handleGetHover] Requesting hover information`);
      const hover: Hover = await server.connection.sendRequest('textDocument/hover', {
        textDocument: { uri } as TextDocumentIdentifier,
        position: { line, character },
      });

      console.log(`[handleGetHover] Received hover response:`, hover);
      return {
        content: [
          {
            type: 'text',
            text: hover?.contents
              ? JSON.stringify(hover.contents, null, 2)
              : 'No hover information available',
          },
        ],
      };
    } catch (error) {
      console.error('[handleGetHover] Request failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: 'Failed to get hover information',
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetCompletions(args: any): Promise<any> {
    const { languageId, filePath, content, line, character } = args;
    console.log(`[handleGetCompletions] Processing request for ${languageId}`);
    
    const server = await this.getOrCreateServer(languageId);
    const uri = `file://${join(server.workspaceRoot, 'src', filePath)}`;

    // Send document to language server
    const textDocument: TextDocumentItem = {
      uri,
      languageId,
      version: 1,
      text: content,
    };

    console.log(`[handleGetCompletions] Sending document to server:`, textDocument);
    await server.connection.sendNotification('textDocument/didOpen', {
      textDocument,
    } as DidOpenTextDocumentParams);

    try {
      console.log(`[handleGetCompletions] Requesting completions`);
      const completionParams: CompletionParams = {
        textDocument: { uri },
        position: { line, character },
      };

      const completions: CompletionItem[] | null = await server.connection.sendRequest(
        'textDocument/completion',
        completionParams
      );

      console.log(`[handleGetCompletions] Received completions:`, completions);
      return {
        content: [
          {
            type: 'text',
            text: completions
              ? JSON.stringify(completions, null, 2)
              : 'No completions available',
          },
        ],
      };
    } catch (error) {
      console.error('[handleGetCompletions] Request failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: 'Failed to get completions',
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetDiagnostics(args: any): Promise<any> {
    const { languageId, filePath, content } = args;
    console.log(`[handleGetDiagnostics] Processing request for ${languageId}`);
    
    const server = await this.getOrCreateServer(languageId);
    const uri = `file://${join(server.workspaceRoot, 'src', filePath)}`;

    // Send document to language server
    const textDocument: TextDocumentItem = {
      uri,
      languageId,
      version: 1,
      text: content,
    };

    console.log(`[handleGetDiagnostics] Setting up diagnostics listener for ${uri}`);
    return new Promise((resolve) => {
      // Set up one-time diagnostics listener
      const listeners = this.diagnosticsListeners.get(uri) || [];
      const listener = (params: PublishDiagnosticsParams) => {
        console.log(`[handleGetDiagnostics] Received diagnostics for ${uri}:`, params);
        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify(params.diagnostics, null, 2),
            },
          ],
        });

        // Remove listener after receiving diagnostics
        const index = listeners.indexOf(listener);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      };
      listeners.push(listener);
      this.diagnosticsListeners.set(uri, listeners);

      // Send document to trigger diagnostics
      console.log(`[handleGetDiagnostics] Sending document to server:`, textDocument);
      server.connection.sendNotification('textDocument/didOpen', {
        textDocument,
      } as DidOpenTextDocumentParams);

      // Set timeout
      setTimeout(() => {
        console.log(`[handleGetDiagnostics] Timeout reached for ${uri}`);
        const index = listeners.indexOf(listener);
        if (index !== -1) {
          listeners.splice(index, 1);
          resolve({
            content: [
              {
                type: 'text',
                text: 'No diagnostics received within timeout',
              },
            ],
          });
        }
      }, 2000);
    });
  }

  async run() {
    console.log('[run] Starting Language Server MCP');
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.log('[run] Language Server MCP running on stdio');
  }
}

const server = new LanguageServerMCP();
server.run().catch(console.error);
