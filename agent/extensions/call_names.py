"""Call names: Bomby names the call once it knows what it's about, in a few words. The name
is the call's own in the app, which the user changes whether this is on or not; this only
gives the voice model `name_call`, which reaches the app over RPC (`bridge.py`):
`call_names.set`.

The app sends the call's name when it starts (`CallNameData`), so a resumed call isn't
named again for nothing. Kept light on purpose: the voice model has a lot on its plate.
"""

from typing import ClassVar, final, override

from livekit.agents.llm import ToolError, Toolset, function_tool
from pydantic import BaseModel, ConfigDict, ValidationError

from voice_providers import Tools

from .extension import Extension, ExtensionContext, ExtensionError


class CallNameData(BaseModel):
    """What the app sends for the extension, and answers `call_names.set` with: the call's
    name, None until it has one."""

    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True, extra="ignore")

    name: str | None = None


@final
class CallNames(Extension):
    id = "call_names"
    name = "Call names"
    description = "Bomby names each call once it knows what it's about."

    @override
    def note(self, context: ExtensionContext) -> str:
        style = context.style
        try:
            data = CallNameData.model_validate(context.data)
        except ValidationError:
            data = CallNameData()
        note = (
            f"You can name this call with {style.code('name_call')} once you know what "
            "it's about, in a few words."
        )
        if data.name:
            note += f' It\'s called "{data.name}".'
        return style.section("Call name", note)

    @override
    def tools(self, context: ExtensionContext) -> Tools:
        bridge = context.bridge

        @function_tool()
        async def name_call(name: str) -> str:
            """Name this call, as it shows in the app.

            Args:
                name: A few words on what the call is about, under 60 characters.
            """
            if not name.strip():
                raise ToolError("Say the name.")
            try:
                answer = await bridge.call("call_names.set", {"name": name})
            except ExtensionError as e:
                raise ToolError(str(e)) from e
            try:
                named = CallNameData.model_validate(answer)
            except ValidationError as e:
                raise ToolError("The app answered with something unexpected.") from e
            return f'The call is named "{named.name}".'

        return [Toolset(id=self.id, tools=[name_call])]


CALL_NAMES_EXTENSION = CallNames()
