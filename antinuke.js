const { Client, GatewayIntentBits, Collection } = require('discord.js');
const mongoose = require('mongoose');
const config = require('./configs/antinuke.json');
const fs = require('fs');
const path = require('path');

// Создаём клиента Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent
  ]
});

// Подключение к MongoDB
mongoose.connect(config.mongodb)
  .then(() => console.log("✅ MongoDB подключена"))
  .catch(err => {
    console.error("❌ Ошибка подключения к MongoDB:", err);
    process.exit(1);
  });

// Коллекция команд
client.commands = new Collection();

// Функция для загрузки обработчиков (handlers)
const loadHandlers = () => {
  const handlersPath = path.join(__dirname, 'handlers');
  fs.readdirSync(handlersPath).forEach(file => {
    if (file.endsWith('.js')) {
      try {
        const handler = require(path.join(handlersPath, file));
        if (typeof handler === 'function') {
          handler(client);
          console.log(`✅ Загружен обработчик: ${file}`);
        } else {
          console.error(`❌ Ошибка: ${file} не экспортирует функцию.`);
        }
      } catch (err) {
        console.error(`❌ Ошибка при загрузке ${file}:`, err);
      }
    }
  });
};

// Функция для загрузки команд (commands)
const loadCommands = () => {
  const commandsPath = path.join(__dirname, 'commands');
  fs.readdirSync(commandsPath).forEach(file => {
    if (file.endsWith('.js')) {
      try {
        const command = require(path.join(commandsPath, file));
        if (command.data && command.execute) {
          client.commands.set(command.data.name, command);
          console.log(`✅ Загружена команда: ${command.data.name}`);
        } else {
          console.error(`❌ Ошибка: ${file} не экспортирует data или execute.`);
        }
      } catch (err) {
        console.error(`❌ Ошибка при загрузке ${file}:`, err);
      }
    }
  });
};

// Запуск обработчиков и команд после готовности бота
client.once('ready', () => {
  console.log(`✅ Бот ${client.user.tag} успешно запущен!`);
  loadHandlers();
  loadCommands();
});

// Обработчик выполнения команд
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`❌ Ошибка выполнения команды ${interaction.commandName}:`, error);
    await interaction.reply({ content: '❌ Ошибка при выполнении команды!', ephemeral: true });
  }
});

// Обработка ошибок клиента
client.on('error', err => console.error("❌ Ошибка Discord.js:", err));

// Запуск бота
client.login(config.token)
  .catch(err => {
    console.error("❌ Ошибка при входе в Discord:", err);
    process.exit(1);
  });