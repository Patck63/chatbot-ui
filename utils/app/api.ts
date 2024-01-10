import { Plugin, PluginID } from '@/types/plugin';

const domain = 'http://localhost:8000'

export const getEndpoint = (plugin: Plugin | null) => {
  if (!plugin) {
    return `${domain}/simple_chat/stream`;
    // return 'api/chat';
  }

  if (plugin.id === PluginID.GOOGLE_SEARCH) {
    return 'api/google';
  }

  return `${domain}/simple_chat/stream`;
  // return 'api/chat';
};
