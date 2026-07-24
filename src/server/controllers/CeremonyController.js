const Logger = require('../../api/logger.js');

const CeremonyController = {
    sendLog: async (req, res) => {
        try {
            const usersInGame = req.body.users;

            console.log(usersInGame)
            new Logger("CeremonyController", "SERVER").info(usersInGame);

            res.status(200).json({ message: "Users logged successfully" });
        } catch (error) {
            new Logger("CeremonyController", "SERVER").error(
                "Error logging users:",
                error
            );
            res.status(500).send("Error logging users");
        }
    },
};

module.exports = CeremonyController;
