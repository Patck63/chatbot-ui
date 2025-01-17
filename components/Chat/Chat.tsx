
import { IconEraser, IconSettings } from '@tabler/icons-react';
import {
  MutableRefObject,
  memo,
  use,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import toast from 'react-hot-toast';

import { getEndpoint } from '@/utils/app/api';
import {
  saveConversation,
  saveConversations,
  updateConversation,
} from '@/utils/app/conversation';
import { throttle } from '@/utils/data/throttle';

import { ChatBody, Conversation, Message } from '@/types/chat';
import { Plugin } from '@/types/plugin';

import HomeContext from '@/pages/api/home/home.context';

import Spinner from '../Spinner';
import { ChatInput } from './ChatInput';
import { ChatLoader } from './ChatLoader';
import { ErrorMessageDiv } from './ErrorMessageDiv';
import { ModelSelect } from './ModelSelect';
import { SystemPrompt } from './SystemPrompt';
import { TemperatureSlider } from './Temperature';
import { MemoizedChatMessage } from './MemoizedChatMessage';

import Image from 'next/image';
import logo from '/public/images/logo.png';

interface Props {
  stopConversationRef: MutableRefObject<boolean>;
}

export const Chat = memo(({ stopConversationRef }: Props) => {

  const {
    state: {
      selectedConversation,
      conversations,
      models,
      apiKey,
      pluginKeys,
      serverSideApiKeyIsSet,
      messageIsStreaming,
      modelError,
      loading,
      prompts,
    },
    handleUpdateConversation,
    dispatch: homeDispatch,
  } = useContext(HomeContext);

  const [currentMessage, setCurrentMessage] = useState<Message>();
  const [autoScrollEnabled, setAutoScrollEnabled] = useState<boolean>(true);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showScrollDownButton, setShowScrollDownButton] =
    useState<boolean>(false);
  const [passcode, setPasscode] = useState('');
  const [passcodeError, setPasscodeError] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(
    async (message: Message, deleteCount = 0, plugin: Plugin | null = null) => {
      if (selectedConversation) {
        let updatedConversation: Conversation;
        if (deleteCount) {
          const updatedMessages = [...selectedConversation.messages];
          for (let i = 0; i < deleteCount; i++) {
            updatedMessages.pop();
          }
          updatedConversation = {
            ...selectedConversation,
            messages: [...updatedMessages, message],
          };
        } else {
          updatedConversation = {
            ...selectedConversation,
            messages: [...selectedConversation.messages, message],
          };
        }
        homeDispatch({
          field: 'selectedConversation',
          value: updatedConversation,
        });
        homeDispatch({ field: 'loading', value: true });
        homeDispatch({ field: 'messageIsStreaming', value: true });
        const chatBody: ChatBody = {
          model: updatedConversation.model,
          messages: updatedConversation.messages,
          key: apiKey,
          prompt: updatedConversation.prompt,
          temperature: updatedConversation.temperature,
        };

        const endpoint = getEndpoint(plugin);
        let body;
        if (!plugin) {
          // body = JSON.stringify(chatBody);
          body = JSON.stringify({
            input: {
              messages: [
                {
                    content: updatedConversation.messages[updatedConversation.messages.length - 1].content,
                    additional_kwargs: {},
                    type: "human",
                    example: false
                }
            ]
            },
            config: {
              configurable: {
                session_id: "test_session_6"
            }
            },
            kwargs: {}
          })
        } else {
          body = JSON.stringify({
            ...chatBody,
            googleAPIKey: pluginKeys
              .find((key) => key.pluginId === 'google-search')
              ?.requiredKeys.find((key) => key.key === 'GOOGLE_API_KEY')?.value,
            googleCSEId: pluginKeys
              .find((key) => key.pluginId === 'google-search')
              ?.requiredKeys.find((key) => key.key === 'GOOGLE_CSE_ID')?.value,
          });
        }
        const controller = new AbortController();
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body,
        });


        if (!response.ok) {
          homeDispatch({ field: 'loading', value: false });
          homeDispatch({ field: 'messageIsStreaming', value: false });
          toast.error(response.statusText);
          return;
        }
        const data = response.body;
        if (!data) {
          homeDispatch({ field: 'loading', value: false });
          homeDispatch({ field: 'messageIsStreaming', value: false });
          return;
        }
        if (!plugin) {
          if (updatedConversation.messages.length === 1) {
            const { content } = message;
            const customName =
              content.length > 30 ? content.substring(0, 30) + '...' : content;
            updatedConversation = {
              ...updatedConversation,
              name: customName,
            };
          }
          homeDispatch({ field: 'loading', value: false });
          const reader = data.getReader();
          const decoder = new TextDecoder();
          let done = false;
          let isFirst = true;
          let text = '';
          while (!done) {
            if (stopConversationRef.current === true) {
              controller.abort();
              done = true;
              break;
            }
            const { value, done: doneReading } = await reader.read();
            done = doneReading;
            const chunkValue = decoder.decode(value, {stream: true});
            // console.log("chunkValue\n\n", chunkValue)
            // text += chunkValue;

            // // Split the chunkValue into separate events
            const events = chunkValue.split('\r\n\r\n');

            for (const event of events) {
              // Split the event into its fields
              const fields = event.split('\n');
              // console.log("fields", fields)
              let eventType = '';
              let eventData = '';
            
              for (const field of fields) {
                if (field.startsWith('event: ')) {
                  eventType = field.substring(7);
                  // console.log("eventType", eventType)
                } else if (field.startsWith('data: ')) {
                  eventData = field.substring(6).trim()
                  // console.log("eventData", eventData)
                }

                 // Only process 'data' events
                if (eventType === 'data\r') {
                  // Parse the JSON string
                  try {
                    if (eventData !== '') {
                      const data = JSON.parse(eventData);
                      // console.log("Parsed data:", data);
                
                      // Concatenate the "content" to the text
                      text += data.content;
                    }
                  } catch (error) {
                    console.error("Error parsing JSON:", error);
                  }
                }
              }
            }

            if (isFirst) {
              isFirst = false;
              const updatedMessages: Message[] = [
                ...updatedConversation.messages,
                { role: 'assistant', content: chunkValue },
              ];
              updatedConversation = {
                ...updatedConversation,
                messages: updatedMessages,
              };
              homeDispatch({
                field: 'selectedConversation',
                value: updatedConversation,
              });
            } else {
              const updatedMessages: Message[] =
                updatedConversation.messages.map((message, index) => {
                  if (index === updatedConversation.messages.length - 1) {
                    return {
                      ...message,
                      content: text,
                    };
                  }
                  return message;
                });
              updatedConversation = {
                ...updatedConversation,
                messages: updatedMessages,
              };
              homeDispatch({
                field: 'selectedConversation',
                value: updatedConversation,
              });
            }
          }
          saveConversation(updatedConversation);
          const updatedConversations: Conversation[] = conversations.map(
            (conversation) => {
              if (conversation.id === selectedConversation.id) {
                return updatedConversation;
              }
              return conversation;
            },
          );
          if (updatedConversations.length === 0) {
            updatedConversations.push(updatedConversation);
          }
          homeDispatch({ field: 'conversations', value: updatedConversations });
          saveConversations(updatedConversations);
          homeDispatch({ field: 'messageIsStreaming', value: false });
        } else {
          const { answer } = await response.json();
          const updatedMessages: Message[] = [
            ...updatedConversation.messages,
            { role: 'assistant', content: answer },
          ];
          updatedConversation = {
            ...updatedConversation,
            messages: updatedMessages,
          };
          homeDispatch({
            field: 'selectedConversation',
            value: updateConversation,
          });
          saveConversation(updatedConversation);
          const updatedConversations: Conversation[] = conversations.map(
            (conversation) => {
              if (conversation.id === selectedConversation.id) {
                return updatedConversation;
              }
              return conversation;
            },
          );
          if (updatedConversations.length === 0) {
            updatedConversations.push(updatedConversation);
          }
          homeDispatch({ field: 'conversations', value: updatedConversations });
          saveConversations(updatedConversations);
          homeDispatch({ field: 'loading', value: false });
          homeDispatch({ field: 'messageIsStreaming', value: false });
        }
      }
    },
    [
      apiKey,
      conversations,
      pluginKeys,
      selectedConversation,
      stopConversationRef,
    ],
  );

  const scrollToBottom = useCallback(() => {
    if (autoScrollEnabled) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      textareaRef.current?.focus();
    }
  }, [autoScrollEnabled]);

  const handleScroll = () => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } =
        chatContainerRef.current;
      const bottomTolerance = 30;

      if (scrollTop + clientHeight < scrollHeight - bottomTolerance) {
        setAutoScrollEnabled(false);
        setShowScrollDownButton(true);
      } else {
        setAutoScrollEnabled(true);
        setShowScrollDownButton(false);
      }
    }
  };

  const handleScrollDown = () => {
    chatContainerRef.current?.scrollTo({
      top: chatContainerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  };

  const handleSettings = () => {
    setShowSettings(!showSettings);
  };

  const onClearAll = () => {
    if (
      confirm('Are you sure you want to clear all messages?') &&
      selectedConversation
    ) {
      handleUpdateConversation(selectedConversation, {
        key: 'messages',
        value: [],
      });
    }
  };

  const scrollDown = () => {
    if (autoScrollEnabled) {
      messagesEndRef.current?.scrollIntoView(true);
    }
  };
  const throttledScrollDown = throttle(scrollDown, 250);

  const handlePasscodeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setPasscode(event.target.value);
  };
  
  const handleSubmitPasscode = () => {
    if (passcode !== "hip-seng-gpt-testing") {
      setPasscodeError(true);
    }else{
      homeDispatch({ field: 'apiKey', value: passcode });
      localStorage.setItem('apiKey', passcode);
    }
  };

  // useEffect(() => {
  //   console.log('currentMessage', currentMessage);
  //   if (currentMessage) {
  //     handleSend(currentMessage);
  //     homeDispatch({ field: 'currentMessage', value: undefined });
  //   }
  // }, [currentMessage]);

  useEffect(() => {
    window.addEventListener("unload", function (e) {
      localStorage.removeItem('apiKey');
      localStorage.removeItem('selectedConversation');
      localStorage.removeItem('conversationHistory');
    });
    return () => {
      window.removeEventListener("unload", function (e) {
      });
    };
  }, []);
  
  

  useEffect(() => {
    throttledScrollDown();
    selectedConversation &&
      setCurrentMessage(
        selectedConversation.messages[selectedConversation.messages.length - 2],
      );
  }, [selectedConversation, throttledScrollDown]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setAutoScrollEnabled(entry.isIntersecting);
        if (entry.isIntersecting) {
          textareaRef.current?.focus();
        }
      },
      {
        root: null,
        threshold: 0.5,
      },
    );
    const messagesEndElement = messagesEndRef.current;
    if (messagesEndElement) {
      observer.observe(messagesEndElement);
    }
    return () => {
      if (messagesEndElement) {
        observer.unobserve(messagesEndElement);
      }
    };
  }, [messagesEndRef]);


  return (
    <div className="relative flex-1 overflow-hidden bg-white dark:bg-[#343541]">
      {!(apiKey || serverSideApiKeyIsSet) ? (
        <div className="mx-auto flex h-full w-[300px] flex-col justify-center space-y-6 sm:w-[600px]">
          <div className="text-center text-4xl font-bold text-black dark:text-white">
            Welcome to HipSengGPT
          </div>
          <div className="text-center text-lg text-black dark:text-white">
            <div className="mb-8">Enter the passcode to start chatting</div>
          </div>
          
          <input
            type="password"
            value={passcode}
            onChange={handlePasscodeChange}
            className="border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
          />
          <button
            onClick={handleSubmitPasscode}
            className="bg-[#e34a0b] text-white rounded-md px-4 py-2 mt-4 hover:bg-[#c20017] focus:outline-none focus:bg-[#fv4f17]"
            >
            Submit
          </button>
          { passcodeError ? (
            <div className="text-center text-sm text-red-500">
              <div>Passcode is incorrect</div>
            </div>
          ) : null }
        </div>
      ) : modelError ? (
        <ErrorMessageDiv error={modelError} />
      ) : (
        <>
          <div
            className="max-h-full overflow-x-hidden"
            ref={chatContainerRef}
            onScroll={handleScroll}
          >
            {selectedConversation?.messages.length === 0 ? (
              <>
                <div className="mx-auto flex flex-col space-y-5 md:space-y-10 px-3 pt-5 md:pt-12 sm:max-w-[600px]">
                  <div className="text-center text-2xl font-semibold text-gray-800 dark:text-gray-100" style={{ fontFamily: 'Arial' }}>
                    <div className="text-center">
                      <Image src={logo} alt="Logo" className="mx-auto"/>
                    </div>
                    {models.length === 0 ? (
                      <div>
                        <Spinner size="16px" className="mx-auto" />
                      </div>
                    ) : (
                      <div className='mt-1'>HipSengGPT</div>
                    )}
                    <div className='mt-6'>
                      <button
                        className="cursor-pointer hover:opacity-50"
                        onClick={handleSettings}
                      >
                        <IconSettings size={24} />
                      </button>
                    </div>
                  </div>
                  
                  
                  {showSettings && (
                  <div style={{
                    position: 'fixed', 
                    zIndex: 1000, 
                    top: '50%', 
                    left: '50%', 
                    transform: 'translate(-50%, -50%)', 
                    backgroundColor: 'white',
                    boxShadow: '0px 4px 20px rgba(0, 0, 0, 0.5)',
                  }} className="flex flex-col space-y-10 md:mx-auto md:max-w-xl md:gap-6 md:py-0 md:pt-0 lg:max-w-2xl lg:px-0 xl:max-w-3xl">
                    <div className="flex h-full flex-col space-y-4 border-b border-neutral-200 p-4 dark:border-neutral-600 md:rounded-lg md:border">
                      {/* <ModelSelect /> */}
                      <TemperatureSlider
                        label='Temperature'
                        onChangeTemperature={(temperature) =>
                          handleUpdateConversation(selectedConversation!, {
                            key: 'temperature',
                            value: temperature,
                          })
                        }
                      />
                    </div>
                  </div>
                )}

                  {/* {models.length > 0 && (
                    <div className="flex h-full flex-col space-y-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-600">
                      <ModelSelect />

                      <SystemPrompt
                        conversation={selectedConversation}
                        prompts={prompts}
                        onChangePrompt={(prompt) =>
                          handleUpdateConversation(selectedConversation, {
                            key: 'prompt',
                            value: prompt,
                          })
                        }
                      />

                      <TemperatureSlider
                        label='Temperature'
                        onChangeTemperature={(temperature) =>
                          handleUpdateConversation(selectedConversation, {
                            key: 'temperature',
                            value: temperature,
                          })
                        }
                      />
                    </div>
                  )} */}
                </div>
              </>
            ) : (
              <>
                <div className="sticky top-0 z-10 flex justify-between items-center border border-b-neutral-300 bg-neutral-100 py-2 text-sm text-neutral-500 dark:border-none dark:bg-[#444654] dark:text-neutral-200">
                  <button
                    className="ml-2 cursor-pointer hover:opacity-50"
                    onClick={handleSettings}
                  >
                    <IconSettings size={24} />
                  </button>
                  <div className="flex-grow text-center">
                    <Image src={logo} alt="Logo" className="mx-auto"/>
                  </div>
                  <div className="flex items-center">
                    {/* {'Model'}: {selectedConversation?.model.name} | {'Temp'}
                    : {selectedConversation?.temperature} | */}
                    <button
                      className="mr-2 cursor-pointer hover:opacity-50"
                      onClick={onClearAll}
                    >
                      <IconEraser size={24} />
                    </button>
                  </div>
                </div>
                {showSettings && (
                  <div style={{
                    position: 'fixed', 
                    zIndex: 1000, 
                    top: '50%', 
                    left: '50%', 
                    transform: 'translate(-50%, -50%)', 
                    backgroundColor: 'white',
                    boxShadow: '0px 4px 20px rgba(0, 0, 0, 0.5)',
                  }} className="flex flex-col space-y-10 md:mx-auto md:max-w-xl md:gap-6 md:py-0 md:pt-0 lg:max-w-2xl lg:px-0 xl:max-w-3xl">
                    <div className="flex h-full flex-col space-y-4 border-b border-neutral-200 p-4 dark:border-neutral-600 md:rounded-lg md:border">
                      {/* <ModelSelect /> */}
                      <TemperatureSlider
                        label='Temperature'
                        onChangeTemperature={(temperature) =>
                          handleUpdateConversation(selectedConversation!, {
                            key: 'temperature',
                            value: temperature,
                          })
                        }
                      />
                    </div>
                  </div>
                )}

                {selectedConversation?.messages.map((message, index) => (
                  <MemoizedChatMessage
                    key={index}
                    message={message}
                    messageIndex={index}
                    onEdit={(editedMessage) => {
                      setCurrentMessage(editedMessage);
                      // discard edited message and the ones that come after then resend
                      handleSend(
                        editedMessage,
                        selectedConversation?.messages.length - index,
                      );
                    }}
                  />
                ))}

                {loading && <ChatLoader />}

                <div
                  className="h-[162px] bg-white dark:bg-[#343541]"
                  ref={messagesEndRef}
                />
              </>
            )}
          </div>

          <ChatInput
            stopConversationRef={stopConversationRef}
            textareaRef={textareaRef}
            onSend={(message, plugin) => {
              setCurrentMessage(message);
              handleSend(message, 0, plugin);
            }}
            onScrollDownClick={handleScrollDown}
            onRegenerate={() => {
              if (currentMessage) {
                handleSend(currentMessage, 2, null);
              }
            }}
            showScrollDownButton={showScrollDownButton}
          />
        </>
      )}
    </div>
  );
});
Chat.displayName = 'Chat';
