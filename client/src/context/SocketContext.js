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

        newSocket = io(backendUrl);

        newSocket.on('connect', () => {
          newSocket.emit('join', user.id);
        });

        newSocket.on('online-users', (users) => {
          setOnlineUsers(users);
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
