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

    const didInit = React.useRef(false);

    useEffect(() => {
        // Check if running in iframe (simple check for now)
        // Or checking specific query params usually present in Activites
        const inIframe = window.self !== window.top;
        if (!inIframe) {
            setIsLoaded(true);
            return;
        }

        if (didInit.current) return;
        didInit.current = true;

        setIsEmbedded(true);

        const initSdk = async () => {
            try {
                // 1. Fetch Client ID
                const { data: { clientId } } = await axios.get('/auth/client-id');

                // 2. Init SDK
                const sdk = new DiscordSDK(clientId);
                await sdk.ready();
                setDiscordSdk(sdk);

                // 2.5 Check if we already have a session
                try {
                    const { data: user } = await axios.get('/auth/me');
                    if (user && user.id) {
                        setActivityUser(user);
                        setIsLoaded(true);
                        return; // Skip authentication
                    }
                } catch (e) {
                    // Not authenticated, proceed
                }

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
                    // Update session user for pure backend calls
                    // setActivityUser(authResp.data.user);

                    // 5. Authenticate with Discord Client using the access token
                    const { access_token } = authResp.data;
                    const authResult = await sdk.commands.authenticate({
                        access_token
                    });

                    if (authResult.user) {
                        // We can use the user from the SDK or the one from backend. 
                        // The backend one has our custom fields (isOfficer), so let's merge or prefer backend.
                        // Actually, authResult.user is the raw discord user.
                        // Let's stick to the backend user which has the roles computed, 
                        // effectively confirming we are "logged in" both sides.
                        setActivityUser(authResp.data.user);
                    }
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
