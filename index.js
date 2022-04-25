const config = require("./config.json");

const Database = require("easy-json-database");
const db = new Database("./db.json");
if (!db.has("subscriptions")) db.set("subscriptions", []);

const Discord = require("discord.js");
const client = new Discord.Client({
  intents: [Discord.Intents.FLAGS.GUILDS],
});

const synchronizeSlashCommands = require("discord-sync-commands");
synchronizeSlashCommands(
  client,
  [
    {
      name: "cop",
      description: "Abonnez-vous à une URL de recherche",
      options: [
        {
          name: "url",
          description: "L'URL de la recherche Vinted",
          type: 3,
          required: true,
        },
        {
          name: "channel",
          description:
            "Le salon dans lequel vous souhaitez envoyer les notifications",
          type: 7,
          required: true,
        },
      ],
    },
    {
      name: "uncop",
      description: "Désabonnez-vous d'une URL de recherche",
      options: [
        {
          name: "id",
          description: "L'identifiant de l'abonnement (/abonnements)",
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: "abonnements",
      description: "Accèdez à la liste de tous vos abonnements",
      options: [],
    },
  ],
  {
    debug: false,
    guildId: config.guildID,
  }
).then((stats) => {
  console.log(
    `🔁 Commandes mises à jour ! ${stats.newCommandCount} commandes créées, ${stats.currentCommandCount} commandes existantes\n`
  );
});

const vinted = require("vinted-api");

let lastFetchFinished = true;

const syncSubscription = (sub) => {
  return new Promise((resolve) => {
    vinted
      .search(sub.url, false, {
        per_page: "20",
      })
      .then((res) => {
        if (!res.items) {
          console.log(
            "Search done bug got wrong response. Promise resolved.",
            res
          );
          resolve();
          return;
        }
        const isFirstSync = db.get("is_first_sync");
        const lastItemTimestamp = db.get(`last_item_ts_${sub.id}`);
        const items = res.items
          .sort(
            (a, b) =>
              new Date(b.created_at_ts).getTime() -
              new Date(a.created_at_ts).getTime()
          )
          .filter(
            (item) =>
              !lastItemTimestamp ||
              new Date(item.created_at_ts) > lastItemTimestamp
          );

        if (!items.length) return void resolve();

        const newLastItemTimestamp = new Date(items[0].created_at_ts).getTime();
        if (!lastItemTimestamp || newLastItemTimestamp > lastItemTimestamp) {
          db.set(`last_item_ts_${sub.id}`, newLastItemTimestamp);
        }

        const itemsToSend =
          lastItemTimestamp && !isFirstSync ? items.reverse() : [items[0]];

        for (let item of itemsToSend) {
          if (!db.get(`items_${sub.id}`)) db.set(`items_${sub.id}`, []);
          if (db.get(`items_${sub.id}`).includes(item.id)) return;
          db.push(`items_${sub.id}`, item.id);

          const embed = new Discord.MessageEmbed()
            .setTitle(item.title)
            .setURL(`${item.url}`)
            .setImage(item.photo?.url)
            .setColor("#371b94")
            .setTimestamp(new Date())
            .setFooter(`Horizon Cop `)
            .setDescription(
              `**Prix: __` +
                (item.price || "vide") +
                "€__**\n\n**Taille: __" +
                (item.size_title || "vide") +
                "__**\n" /*"**Condition: __" +
                (Math.round(item.search_tracking_params.score) * "⭐" ||
                  "vide") +
                "__**" */
            );
          /*             .addField("Taille", item.size || "vide", true)
            .addField("Prix", item.price || "vide", true)
            .addField("Condition", item.status || "vide", true); */
          client.channels.cache.get(sub.channelID)?.send({
            embeds: [embed],
            components: [
              new Discord.MessageActionRow().addComponents([
                new Discord.MessageButton()
                  .setLabel("Détails")
                  .setURL(item.url)
                  .setEmoji("🗄️")
                  .setStyle("LINK"),
                new Discord.MessageButton()
                  .setLabel("Acheter")
                  .setURL(
                    `https://www.vinted.fr/transaction/buy/new?source_screen=item&transaction%5Bitem_id%5D=${item.id}`
                  )
                  .setEmoji("🪐")
                  .setStyle("LINK"),
              ]),
            ],
          });
        }

        if (itemsToSend.length > 0) {
          console.log(
            `👕 ${itemsToSend.length} ${
              itemsToSend.length > 1
                ? "nouveaux articles trouvés"
                : "nouvel article trouvé"
            } pour la recherche ${sub.id} !\n`
          );
        }

        resolve();
      })
      .catch((e) => {
        console.error("Search returned an error. Promise resolved.", e);
        resolve();
      });
  });
};

const sync = () => {
  if (!lastFetchFinished) return;
  lastFetchFinished = false;

  setTimeout(() => {
    lastFetchFinished = true;
  }, 20_000);

  console.log(`🤖 Synchronisation à Vinted...\n`);

  const subscriptions = db.get("subscriptions");
  const promises = subscriptions.map((sub) => syncSubscription(sub));
  Promise.all(promises).then(() => {
    db.set("is_first_sync", false);
    lastFetchFinished = true;
  });
};

client.on("ready", () => {
  console.log(`🔗 Connecté sur le compte de ${client.user.tag} !\n`);

  const entries = db
    .all()
    .filter(
      (e) =>
        e.key !== "subscriptions" &&
        !e.key.startsWith("last_item_ts") &&
        !e.key.startsWith("items_")
    );
  entries.forEach((e) => {
    db.delete(e.key);
  });
  db.set("is_first_sync", true);

  let idx = 0;

  sync();
  setInterval(sync, 15000);

  const { version } = require("./package.json");
  client.user.setActivity(`.gg/horizon`);
});

client.on("interactionCreate", (interaction) => {
  if (!interaction.isCommand()) return;
  if (!config.adminIDs.includes(interaction.user.id))
    return void interaction.reply(
      `:x: Vous ne disposez pas des droits pour effectuer cette action !`
    );

  switch (interaction.commandName) {
    case "cop": {
      const member = client.guilds.cache
        .get(interaction.guildId)
        .members.cache.get(interaction.user.id);
      if (!member.roles.cache.some((role) => role.id === "878326169664114719"))
        return interaction.reply(`❌ Vous n'avez pas la permission`);

      const sub = {
        id: Math.random().toString(36).substring(7),
        url: interaction.options.getString("url"),
        channelID: interaction.options.getChannel("channel").id,
      };
      db.push("subscriptions", sub);
      db.set(`last_item_ts_${sub.id}`, null);
      interaction.reply(
        `:white_check_mark: Votre abonnement a été créé avec succès !\n**URL**: <${sub.url}>\n**Salon**: <#${sub.channelID}>`
      );
      break;
    }
    case "uncop": {
      const subID = interaction.options.getString("id");
      const subscriptions = db.get("subscriptions");
      const subscription = subscriptions.find((sub) => sub.id === subID);
      if (!subscription) {
        return void interaction.reply(
          ":x: Aucun abonnement trouvé pour votre recherche..."
        );
      }
      const newSubscriptions = subscriptions.filter((sub) => sub.id !== subID);
      db.set("subscriptions", newSubscriptions);
      interaction.reply(
        `:white_check_mark: Abonnement supprimé avec succès !\n**URL**: <${subscription.url}>\n**Salon**: <#${subscription.channelID}>`
      );
      break;
    }
    case "abonnements": {
      const subscriptions = db.get("subscriptions");
      const chunks = [];

      subscriptions.forEach((sub) => {
        const content = `**ID**: ${sub.id}\n**URL**: ${sub.url}\n**Salon**: <#${sub.channelID}>\n`;
        const lastChunk = chunks.shift() || [];
        if (lastChunk.join("\n").length + content.length > 1024) {
          if (lastChunk) chunks.push(lastChunk);
          chunks.push([content]);
        } else {
          lastChunk.push(content);
          chunks.push(lastChunk);
        }
      });

      interaction.reply(
        `:white_check_mark: **${subscriptions.length}** abonnements sont actifs !`
      );

      chunks.forEach((chunk) => {
        const embed = new Discord.MessageEmbed()
          .setColor("RED")
          .setAuthor(
            `Utilisez la commande /désabonner pour supprimer un abonnement !`
          )
          .setDescription(chunk.join("\n"));

        interaction.channel.send({ embeds: [embed] });
      });
    }
  }
});

client.login(config.token);
