import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { getBackendUrl } from '../services/api';

const SocketContext = createContext();

export function useSocket() {
  return useContext(SocketContext);
}

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      let cancelled = false;
      let newSocket;

      getBackendUrl().then((backendUrl) => {
        if (cancelled) return;

        // Force WebSocket for better real-time performance and stability
        newSocket = io(backendUrl, {
          transports: ['websocket'],
          upgrade: false,
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
        });

        newSocket.on('connect', () => {
          console.log('Socket connected:', newSocket.id);
          newSocket.emit('join', user.id);
        });

        newSocket.on('reconnect', () => {
          console.log('Socket reconnected, re-joining room...');
          newSocket.emit('join', user.id);
        });

        setSocket(newSocket);
      }).catch(() => {
        setSocket(null);
      });

      return () => {
        cancelled = true;
        if (newSocket) newSocket.disconnect();
      };
    }
  }, [user]);

  return (
    <SocketContext.Provider value={{ socket, onlineUsers }}>
      {children}
    </SocketContext.Provider>
  );
}
