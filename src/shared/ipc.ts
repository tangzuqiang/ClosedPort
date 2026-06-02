export const IPC_CHANNELS = {
  LIST_PORTS: 'ports:list',
  SCAN_FOLDER: 'folder:scan',
  SCAN_FOLDER_EX: 'folder:scanEx',
  KILL_PROCESS: 'process:kill',
  KILL_PROCESSES: 'process:killMany',
  SYSTEM_INFO: 'system:info',
  TOGGLE_FLOATING: 'window:toggleFloating',
  PICK_FOLDER: 'dialog:pickFolder',
  REVEAL_IN_FOLDER: 'shell:revealInFolder',
  SPAWN_TEST_PORTS: 'devtools:spawnTestPorts'
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
