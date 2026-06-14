// jsdom doesn't expose TextEncoder/TextDecoder; the SSE stream reader needs them.
import { TextDecoder, TextEncoder } from 'node:util';

Object.assign(global, { TextEncoder, TextDecoder });
