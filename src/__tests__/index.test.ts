import { jest } from '@jest/globals';
import { LanguageServerMCP } from '../index.js';
import { MessageConnection, RequestType, RequestType0 } from 'vscode-jsonrpc/node.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

// Mock dependencies
const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: mockSpawn
}));

jest.mock('vscode-jsonrpc/node.js', () => ({
  createMessageConnection: jest.fn().mockReturnValue({
    listen: jest.fn(),
    dispose: jest.fn(),
    sendNotification: jest.fn(),
    sendRequest: jest.fn(),
    onNotification: jest.fn(),
    onRequest: jest.fn()
  }),
  StreamMessageReader: jest.fn(),
  StreamMessageWriter: jest.fn()
}));

// Mock Server from MCP SDK
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: jest.fn(),
    connect: jest.fn(),
    close: jest.fn(),
    onerror: jest.fn()
  }))
}));

jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(true),
  readFileSync: jest.fn()
}));

describe('LanguageServerMCP', () => {
  let server: LanguageServerMCP;
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock environment variables for language servers
    process.env.TYPESCRIPT_SERVER = JSON.stringify({
      command: 'typescript-language-server',
      args: ['--stdio']
    });
    server = new LanguageServerMCP();
  });

  describe('getOrCreateServer', () => {
    it('should create a new language server instance', async () => {
      const mockProcess = {
        stdout: { on: jest.fn(), pipe: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: {},
        on: jest.fn(),
        kill: jest.fn()
      };
      mockSpawn.mockReturnValue(mockProcess);

      const result = await (server as any).getOrCreateServer('typescript', '/test/project');
      
      expect(mockSpawn).toHaveBeenCalledWith(
        'typescript-language-server',
        ['--stdio']
      );
      expect(result.process).toBe(mockProcess);
      expect(result.connection).toBeDefined();
    });

    it('should reuse existing server instance', async () => {
      const mockServer = {
        connection: {} as MessageConnection,
        process: { kill: jest.fn() },
        workspaceRoot: '/test/project'
      };
      (server as any).languageServers.set('typescript:/test/project', mockServer);

      const result = await (server as any).getOrCreateServer('typescript', '/test/project');
      expect(result).toBe(mockServer);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should throw error for unconfigured language server', async () => {
      delete process.env.TYPESCRIPT_SERVER;
      
      await expect((server as any).getOrCreateServer('typescript', '/test/project'))
        .rejects
        .toThrow(new McpError(ErrorCode.InvalidParams, 'No language server configured for typescript'));
    });
  });

  describe('MCP Tool Handlers', () => {
    let mockConnection: jest.Mocked<MessageConnection>;
    const mockHover = {
      contents: { kind: 'markdown', value: 'Test hover content' }
    };

    beforeEach(() => {
      mockConnection = {
        sendNotification: jest.fn(),
        sendRequest: jest.fn(),
        onNotification: jest.fn(),
        onRequest: jest.fn(),
        listen: jest.fn(),
        dispose: jest.fn()
      } as any;

      // Mock successful initialization response
      mockConnection.sendRequest.mockImplementation((...args: any[]) => {
        const method = typeof args[0] === 'string' ? args[0] : args[0].method;
        
        if (method === 'initialize') return Promise.resolve({ capabilities: {} });
        if (method === 'textDocument/hover') return Promise.resolve(mockHover);
        return Promise.resolve(null);
      });

      const mockProcess = {
        stdout: { on: jest.fn(), pipe: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: {},
        on: jest.fn(),
        kill: jest.fn()
      };
      mockSpawn.mockReturnValue(mockProcess);
    });

    describe('get_hover tool', () => {
      it('should return hover information', async () => {
        const mockHover = {
          contents: { kind: 'markdown', value: 'Test hover content' }
        };
        mockConnection.sendRequest.mockImplementation((...args: any[]) => {
          const method = typeof args[0] === 'string' ? args[0] : args[0].method;
          
          if (method === 'initialize') return Promise.resolve({ capabilities: {} });
          if (method === 'textDocument/hover') return Promise.resolve(mockHover);
          return Promise.resolve(null);
        });

        const result = await (server as any).handleGetHover({
          languageId: 'typescript',
          filePath: 'test.ts',
          content: 'const x = 1;',
          line: 0,
          character: 0,
          projectRoot: '/test/project'
        });

        expect(result.content[0].text).toBe(JSON.stringify(mockHover.contents, null, 2));
      });
    });

    describe('get_completions tool', () => {
      it('should return completion items', async () => {
        const mockCompletions = [{ label: 'testCompletion' }];
        mockConnection.sendRequest.mockImplementation((...args: any[]) => {
          const method = typeof args[0] === 'string' ? args[0] : args[0].method;
          
          if (method === 'initialize') return Promise.resolve({ capabilities: {} });
          if (method === 'textDocument/completion') return Promise.resolve(mockCompletions);
          return Promise.resolve(null);
        });

        const result = await (server as any).handleGetCompletions({
          languageId: 'typescript',
          filePath: 'test.ts',
          content: 'const x = 1;',
          line: 0,
          character: 0,
          projectRoot: '/test/project'
        });

        expect(result.content[0].text).toBe(JSON.stringify(mockCompletions, null, 2));
      });
    });

    describe('get_diagnostics tool', () => {
      it('should return diagnostics', async () => {
        const mockDiagnostics = [{ message: 'test diagnostic' }];
        
        const result = await (server as any).handleGetDiagnostics({
          languageId: 'typescript',
          filePath: 'test.ts',
          content: 'const x = 1;',
          projectRoot: '/test/project'
        });

        // Simulate receiving diagnostics
        const uri = 'file:///test/project/test.ts';
        const listeners = (server as any).diagnosticsListeners.get(uri);
        if (listeners && listeners[0]) {
          listeners[0]({ uri, diagnostics: mockDiagnostics });
        }

        expect(mockConnection.sendNotification).toHaveBeenCalledWith(
          'textDocument/didOpen',
          expect.any(Object)
        );
      });
    });
  });
}); 