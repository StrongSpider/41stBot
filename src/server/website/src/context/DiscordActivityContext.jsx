import React, { createContext, useContext, useEffect, useState } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import axios from '../api/axios'; // Ensure this points to your axios instance

const DiscordActivityContext = createContext(null);

export const useDiscordActivity = () => useContext(DiscordActivityContext);

export const DiscordActivityProvider = ({ children }) => {
    const [discordSdk, setDiscordSdk] = useState(null);
    const [authCode, setAuthCode] = useState(null);
    const [activityUser, setActivityUser] = useState(null);
    const [isEmbedded, setIsEmbedded] = useState(false);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        // Check if running in iframe (simple check for now)
        // Or checking specific query params usually present in Activites
        const inIframe = window.self !== window.top;
        if (!inIframe) {
            setIsLoaded(true);
            return;
        }

        setIsEmbedded(true);

        const initSdk = async () => {
            try {
                // 1. Fetch Client ID
                const { data: { clientId } } = await axios.get('/auth/client-id');

                // 2. Init SDK
                const sdk = new DiscordSDK(clientId);
                await sdk.ready();
                setDiscordSdk(sdk);

                // 3. Authenticate
                // "authorize" command returns the code
                const { code } = await sdk.commands.authorize({
                    client_id: clientId,
                    response_type: 'code',
                    state: '',
                    prompt: 'none',
                    scope: ['identify', 'guilds', 'guilds.members.read']
                });

                setAuthCode(code);

                // 4. Send code to backend to establish session
                const authResp = await axios.post('/auth/activity', { code });

                if (authResp.data.success) {
                    setActivityUser(authResp.data.user);
                    // Force reload or just let the app proceed? 
                    // Since session is set, useAuth hook should be able to pick it up if it refetches.
                    // Ideally, useAuth should expose a 'refresh' method, or we trigger it here.
                }

            } catch (err) {
                console.error("Discord Activity Init Error:", err);
            } finally {
                setIsLoaded(true);
            }
        };

        initSdk();
    }, []);

    return (
        <DiscordActivityContext.Provider value={{ discordSdk, isEmbedded, isLoaded, activityUser }}>
            {isLoaded ? children : <div className="flex h-screen w-full items-center justify-center bg-gray-950 text-emerald-500">Loading Activity...</div>}
        </DiscordActivityContext.Provider>
    );
};
